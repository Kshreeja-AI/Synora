import {
  type AgentDefinition,
  type AgentRunResult,
  type AuthContext,
  type ContentPart,
  type ConversationStore,
  type EventBus,
  type Guardrail,
  type GuardrailRef,
  type GuardrailVerdict,
  type Logger,
  type MemoryStore,
  type Message,
  type ModelProviderRegistry,
  PlatformEvents,
  type SessionId,
  type TenantId,
  type ToolDefinition,
  type UserId,
  asAgentId,
  asMessageId,
  asToolCallId,
  messageText,
  textMessage,
} from '@synora/core';
import { makeEvent } from '@synora/event-bus';
import { type ToolRegistry, executeTool } from '@synora/tools';
import { v4 as uuidv4 } from 'uuid';

const HANDOFF_TOOL_NAME = 'handoff_to_agent';

export interface GuardrailResolver {
  resolve(name: string): Guardrail;
}

export interface AgentRuntimeDependencies {
  providerRegistry: ModelProviderRegistry;
  toolRegistry: ToolRegistry;
  conversationStore: ConversationStore;
  memoryStore?: MemoryStore;
  eventBus: EventBus;
  guardrails?: GuardrailResolver;
  logger?: Logger;
}

export interface AgentRunInput {
  tenantId: TenantId;
  userId: UserId;
  sessionId: SessionId;
  message: string;
}

function buildHandoffTool(definition: AgentDefinition): ToolDefinition | undefined {
  if (!definition.handoffTargets || definition.handoffTargets.length === 0) return undefined;
  return {
    name: HANDOFF_TOOL_NAME,
    description:
      'Hand off the conversation to a more specialized agent when the request is better served by one of them.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', enum: definition.handoffTargets },
        reason: { type: 'string' },
      },
      required: ['agentId'],
    },
    readOnly: true,
  };
}

/**
 * Executes a single AgentDefinition end-to-end: guardrails on the way
 * in, memory recall, the model/tool call loop, guardrails on the way
 * out, and a handoff exit if the model calls the synthetic handoff
 * tool. Emits a platform event at every meaningful transition so
 * observability and other products can react without coupling to this
 * class directly.
 */
export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDependencies) {}

  async run(definition: AgentDefinition, input: AgentRunInput): Promise<AgentRunResult> {
    const runId = uuidv4();
    const provider = this.deps.providerRegistry.get(definition.providerId);

    await this.publish(PlatformEvents.AgentRunStarted, input.tenantId, {
      agentId: definition.id,
      runId,
      sessionId: input.sessionId,
    });

    const inputVerdict = await this.runGuardrails(definition.inputGuardrails, input.message, input);
    if (!inputVerdict.allowed) {
      await this.publish(PlatformEvents.GuardrailBlocked, input.tenantId, {
        agentId: definition.id,
        stage: 'input',
        reason: inputVerdict.reason,
      });
      return {
        status: 'failed',
        messages: [],
        error: `Blocked by input guardrail: ${inputVerdict.reason}`,
      };
    }

    const userMessage = textMessage(asMessageId(uuidv4()), 'user', input.message);
    await this.deps.conversationStore.append(input.sessionId, [userMessage]);
    let history = await this.deps.conversationStore.history(input.sessionId);

    const memoryContext = await this.recallMemory(definition, input);
    const effectiveTools = [...definition.tools];
    const handoffTool = buildHandoffTool(definition);
    if (handoffTool) effectiveTools.push(handoffTool);

    const producedMessages: Message[] = [userMessage];
    const maxRoundtrips = definition.maxToolRoundtrips ?? 5;

    for (let round = 0; round < maxRoundtrips; round++) {
      const result = await provider.generate({
        model: definition.model,
        messages: history,
        system: memoryContext
          ? `${definition.instructions}\n\n${memoryContext}`
          : definition.instructions,
        tools: effectiveTools.length > 0 ? effectiveTools : undefined,
        temperature: definition.temperature,
        maxOutputTokens: definition.maxOutputTokens,
      });

      await this.deps.conversationStore.append(input.sessionId, [result.message]);
      history = [...history, result.message];
      producedMessages.push(result.message);

      if (result.finishReason !== 'tool_calls') {
        const text = messageText(result.message);
        const outputVerdict = await this.runGuardrails(definition.outputGuardrails, text, input);
        if (!outputVerdict.allowed) {
          await this.publish(PlatformEvents.GuardrailBlocked, input.tenantId, {
            agentId: definition.id,
            stage: 'output',
            reason: outputVerdict.reason,
          });
          return {
            status: 'failed',
            messages: producedMessages,
            error: `Blocked by output guardrail: ${outputVerdict.reason}`,
          };
        }
        await this.publish(PlatformEvents.AgentRunCompleted, input.tenantId, {
          agentId: definition.id,
          runId,
          sessionId: input.sessionId,
        });
        return { status: 'completed', messages: producedMessages };
      }

      const toolCalls = result.message.content.filter(
        (part): part is Extract<ContentPart, { type: 'tool_call' }> => part.type === 'tool_call',
      );

      const handoffCall = toolCalls.find((call) => call.toolName === HANDOFF_TOOL_NAME);
      if (handoffCall) {
        const targetAgentId = asAgentId(String(handoffCall.input.agentId));
        await this.publish(PlatformEvents.AgentHandoff, input.tenantId, {
          from: definition.id,
          to: targetAgentId,
          sessionId: input.sessionId,
        });
        return { status: 'handed_off', messages: producedMessages, handoffTo: targetAgentId };
      }

      const toolResultParts: ContentPart[] = [];
      for (const call of toolCalls) {
        await this.publish(PlatformEvents.ToolInvoked, input.tenantId, {
          agentId: definition.id,
          toolName: call.toolName,
          sessionId: input.sessionId,
        });
        const toolResult = await executeTool(
          this.deps.toolRegistry,
          { toolCallId: call.toolCallId, toolName: call.toolName, input: call.input },
          { tenantId: input.tenantId, agentId: definition.id, sessionId: input.sessionId },
        );
        await this.publish(
          toolResult.isError ? PlatformEvents.ToolFailed : PlatformEvents.ToolCompleted,
          input.tenantId,
          { agentId: definition.id, toolName: call.toolName, sessionId: input.sessionId },
        );
        toolResultParts.push({
          type: 'tool_result',
          toolCallId: toolResult.toolCallId,
          output: toolResult.output,
          isError: toolResult.isError,
        });
      }

      const toolMessage: Message = {
        id: asMessageId(uuidv4()),
        role: 'tool',
        content: toolResultParts,
        createdAt: new Date().toISOString(),
      };
      await this.deps.conversationStore.append(input.sessionId, [toolMessage]);
      history = [...history, toolMessage];
      producedMessages.push(toolMessage);
    }

    await this.publish(PlatformEvents.AgentRunFailed, input.tenantId, {
      agentId: definition.id,
      runId,
      reason: 'max_tool_roundtrips_exceeded',
    });
    return {
      status: 'failed',
      messages: producedMessages,
      error: 'Maximum tool roundtrips exceeded',
    };
  }

  private async recallMemory(definition: AgentDefinition, input: AgentRunInput): Promise<string> {
    if (!definition.memoryEnabled || !this.deps.memoryStore) return '';
    const memories = await this.deps.memoryStore.search({
      tenantId: input.tenantId,
      agentId: definition.id,
      text: input.message,
      topK: 5,
    });
    if (memories.length === 0) return '';
    await this.publish(PlatformEvents.MemoryRetrieved, input.tenantId, {
      agentId: definition.id,
      count: memories.length,
    });
    return `Relevant memory:\n${memories.map((m) => `- ${m.record.content}`).join('\n')}`;
  }

  private async runGuardrails(
    refs: GuardrailRef[] | undefined,
    text: string,
    input: AgentRunInput,
  ): Promise<GuardrailVerdict> {
    if (!refs || refs.length === 0 || !this.deps.guardrails) return { allowed: true };
    const context: AuthContext = {
      principal: { tenantId: input.tenantId, userId: input.userId, scopes: [] },
      requestId: input.sessionId,
    };
    for (const ref of refs) {
      const guardrail = this.deps.guardrails.resolve(ref.name);
      const verdict = await guardrail.check({ text, context });
      if (!verdict.allowed) return verdict;
    }
    return { allowed: true };
  }

  private async publish(
    type: string,
    tenantId: TenantId,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.eventBus.publish(
      makeEvent({ type, tenantId, payload, source: 'orchestration' }),
    );
  }
}
