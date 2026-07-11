import {
  type AgentId,
  type EventBus,
  PlatformEvents,
  type SessionId,
  type TenantId,
  type UserId,
  type WorkflowDefinition,
  type WorkflowRunResult,
  type WorkflowStep,
  type WorkflowStepTrace,
  asToolCallId,
  messageText,
} from '@synora/core';
import { makeEvent } from '@synora/event-bus';
import { type ToolRegistry, executeTool } from '@synora/tools';
import type { AgentDefinitionRegistry } from './agent-registry.js';
import type { AgentRuntime } from './agent-runtime.js';

export type ConditionPredicate = (
  output: unknown,
  context: WorkflowContext,
) => boolean | Promise<boolean>;

export interface WorkflowContext {
  tenantId: TenantId;
  userId: UserId;
  sessionId: SessionId;
}

export interface OrchestratorDependencies {
  agentRuntime: AgentRuntime;
  agentRegistry: AgentDefinitionRegistry;
  eventBus: EventBus;
  /** Required only if the workflow contains standalone tool steps. */
  toolRegistry?: ToolRegistry;
  /** Maximum agent handoffs to follow automatically within a single AgentStep. */
  maxHandoffHops?: number;
}

/**
 * Executes a declarative WorkflowDefinition graph: sequences run steps
 * in order threading output -> input; parallel branches fan out
 * against the same input and return an array of results; conditions
 * pick a branch via a registered predicate (never eval'd code, so a
 * stored/serialized workflow can't smuggle in arbitrary logic); agent
 * steps run through AgentRuntime and transparently follow handoffs.
 */
export class Orchestrator {
  private readonly conditions = new Map<string, ConditionPredicate>();

  constructor(private readonly deps: OrchestratorDependencies) {}

  registerCondition(name: string, predicate: ConditionPredicate): void {
    this.conditions.set(name, predicate);
  }

  async run(
    workflow: WorkflowDefinition,
    input: unknown,
    context: WorkflowContext,
  ): Promise<WorkflowRunResult> {
    const trace: WorkflowStepTrace[] = [];
    try {
      const output = await this.executeStep(workflow.entry, input, context, trace);
      return { status: 'completed', output, trace };
    } catch (error) {
      return { status: 'failed', output: { error: (error as Error).message }, trace };
    }
  }

  private async executeStep(
    step: WorkflowStep,
    input: unknown,
    context: WorkflowContext,
    trace: WorkflowStepTrace[],
  ): Promise<unknown> {
    const stepTrace: WorkflowStepTrace = {
      stepId: step.id,
      kind: step.kind,
      startedAt: new Date().toISOString(),
    };
    trace.push(stepTrace);
    await this.deps.eventBus.publish(
      makeEvent({
        type: PlatformEvents.WorkflowStepStarted,
        tenantId: context.tenantId,
        payload: { stepId: step.id, kind: step.kind },
        source: 'orchestration',
      }),
    );

    try {
      const output = await this.dispatch(step, input, context, trace);
      stepTrace.completedAt = new Date().toISOString();
      stepTrace.output = output;
      await this.deps.eventBus.publish(
        makeEvent({
          type: PlatformEvents.WorkflowStepCompleted,
          tenantId: context.tenantId,
          payload: { stepId: step.id, kind: step.kind },
          source: 'orchestration',
        }),
      );
      return output;
    } catch (error) {
      stepTrace.completedAt = new Date().toISOString();
      stepTrace.error = (error as Error).message;
      throw error;
    }
  }

  private async dispatch(
    step: WorkflowStep,
    input: unknown,
    context: WorkflowContext,
    trace: WorkflowStepTrace[],
  ): Promise<unknown> {
    switch (step.kind) {
      case 'agent':
        return this.runAgentStep(step.agentId, input, context);

      case 'tool': {
        // Runs a tool directly against the ToolRegistry, with no model in the
        // loop — useful for deterministic pre/post-processing stages that
        // don't need an LLM decision.
        if (!this.deps.toolRegistry) {
          throw new Error(
            `Workflow step "${step.id}" invokes tool "${step.toolName}" but no ToolRegistry was configured on the Orchestrator.`,
          );
        }
        const toolInput =
          typeof input === 'object' && input !== null && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : { value: input };
        const result = await executeTool(
          this.deps.toolRegistry,
          {
            toolCallId: asToolCallId(`workflow:${step.id}`),
            toolName: step.toolName,
            input: toolInput,
          },
          { tenantId: context.tenantId, agentId: 'workflow', sessionId: context.sessionId },
        );
        if (result.isError) {
          throw new Error(`Tool step "${step.id}" (${step.toolName}) failed: ${result.output}`);
        }
        return result.output;
      }

      case 'sequence': {
        let current = input;
        for (const child of step.steps) {
          current = await this.executeStep(child, current, context, trace);
        }
        return current;
      }

      case 'parallel':
        return Promise.all(
          step.branches.map((branch) => this.executeStep(branch, input, context, trace)),
        );

      case 'condition': {
        const predicate = this.conditions.get(step.predicate);
        if (!predicate) throw new Error(`Unknown condition predicate "${step.predicate}"`);
        const branch = (await predicate(input, context)) ? step.ifTrue : step.ifFalse;
        if (!branch) return input;
        return this.executeStep(branch, input, context, trace);
      }

      default: {
        const exhaustive: never = step;
        throw new Error(`Unknown workflow step kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private async runAgentStep(
    agentId: AgentId,
    input: unknown,
    context: WorkflowContext,
  ): Promise<unknown> {
    let definition = this.deps.agentRegistry.get(agentId);
    const message = typeof input === 'string' ? input : JSON.stringify(input);
    let result = await this.deps.agentRuntime.run(definition, {
      tenantId: context.tenantId,
      userId: context.userId,
      sessionId: context.sessionId,
      message,
    });

    let hops = 0;
    const maxHops = this.deps.maxHandoffHops ?? 3;
    while (result.status === 'handed_off' && result.handoffTo && hops < maxHops) {
      definition = this.deps.agentRegistry.get(result.handoffTo);
      const lastMessage = result.messages[result.messages.length - 1];
      const carryOverText = lastMessage ? messageText(lastMessage) || message : message;
      result = await this.deps.agentRuntime.run(definition, {
        tenantId: context.tenantId,
        userId: context.userId,
        sessionId: context.sessionId,
        message: carryOverText,
      });
      hops++;
    }

    if (result.status === 'failed') {
      throw new Error(result.error ?? 'Agent step failed');
    }

    const finalMessage = result.messages[result.messages.length - 1];
    return finalMessage ? messageText(finalMessage) : '';
  }
}
