import {
  type AgentDefinition,
  type GenerateOptions,
  type GenerateResult,
  type ModelProvider,
  type ModelProviderRegistry,
  type StreamEvent,
  asAgentId,
  asMessageId,
  asSessionId,
  asTenantId,
  asToolCallId,
  asUserId,
} from '@synora/core';
import { InMemoryEventBus } from '@synora/event-bus';
import { InMemoryConversationStore } from '@synora/memory';
import { ToolRegistry, defineTool } from '@synora/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from './agent-runtime.js';

class ScriptedProvider implements ModelProvider {
  readonly id = 'scripted';
  readonly capabilities = { streaming: false, toolCalling: true, vision: false, embeddings: false };
  private call = 0;

  constructor(private readonly script: GenerateResult[]) {}

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    const result = this.script[this.call];
    this.call++;
    if (!result) throw new Error('ScriptedProvider ran out of scripted responses');
    return result;
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamEvent> {}
}

class SingleProviderRegistry implements ModelProviderRegistry {
  constructor(private readonly provider: ModelProvider) {}
  register(): void {
    throw new Error('not supported in test double');
  }
  get(): ModelProvider {
    return this.provider;
  }
  list(): ModelProvider[] {
    return [this.provider];
  }
}

const baseAgent: AgentDefinition = {
  id: asAgentId('assistant'),
  name: 'Assistant',
  description: 'test agent',
  instructions: 'Be helpful.',
  providerId: 'scripted',
  model: 'test-model',
  tools: [],
  memoryEnabled: false,
};

describe('AgentRuntime', () => {
  it('returns a completed run when the model answers directly', async () => {
    const provider = new ScriptedProvider([
      {
        message: {
          id: asMessageId('m1'),
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello there!' }],
          createdAt: new Date().toISOString(),
        },
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);

    const runtime = new AgentRuntime({
      providerRegistry: new SingleProviderRegistry(provider),
      toolRegistry: new ToolRegistry(),
      conversationStore: new InMemoryConversationStore(),
      eventBus: new InMemoryEventBus(),
    });

    const result = await runtime.run(baseAgent, {
      tenantId: asTenantId('t1'),
      userId: asUserId('u1'),
      sessionId: asSessionId('s1'),
      message: 'hi',
    });

    expect(result.status).toBe('completed');
  });

  it('executes a tool call and feeds the result back before finishing', async () => {
    const toolRegistry = new ToolRegistry();
    const execute = vi.fn(async ({ a, b }: { a: number; b: number }) => a + b);
    toolRegistry.register(
      defineTool({
        name: 'add',
        description: 'adds two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute,
      }),
    );

    const provider = new ScriptedProvider([
      {
        message: {
          id: asMessageId('m1'),
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: asToolCallId('c1'),
              toolName: 'add',
              input: { a: 2, b: 3 },
            },
          ],
          createdAt: new Date().toISOString(),
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
      {
        message: {
          id: asMessageId('m2'),
          role: 'assistant',
          content: [{ type: 'text', text: 'The answer is 5.' }],
          createdAt: new Date().toISOString(),
        },
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);

    const runtime = new AgentRuntime({
      providerRegistry: new SingleProviderRegistry(provider),
      toolRegistry,
      conversationStore: new InMemoryConversationStore(),
      eventBus: new InMemoryEventBus(),
    });

    const result = await runtime.run(
      { ...baseAgent, tools: [{ name: 'add', description: 'adds', inputSchema: {} }] },
      {
        tenantId: asTenantId('t1'),
        userId: asUserId('u1'),
        sessionId: asSessionId('s1'),
        message: 'what is 2+3?',
      },
    );

    expect(execute).toHaveBeenCalledWith({ a: 2, b: 3 }, expect.anything());
    expect(result.status).toBe('completed');
  });

  it('returns handed_off status when the model calls the handoff tool', async () => {
    const provider = new ScriptedProvider([
      {
        message: {
          id: asMessageId('m1'),
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolCallId: asToolCallId('c1'),
              toolName: 'handoff_to_agent',
              input: { agentId: 'specialist' },
            },
          ],
          createdAt: new Date().toISOString(),
        },
        finishReason: 'tool_calls',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);

    const runtime = new AgentRuntime({
      providerRegistry: new SingleProviderRegistry(provider),
      toolRegistry: new ToolRegistry(),
      conversationStore: new InMemoryConversationStore(),
      eventBus: new InMemoryEventBus(),
    });

    const result = await runtime.run(
      { ...baseAgent, handoffTargets: [asAgentId('specialist')] },
      {
        tenantId: asTenantId('t1'),
        userId: asUserId('u1'),
        sessionId: asSessionId('s1'),
        message: 'help',
      },
    );

    expect(result.status).toBe('handed_off');
    expect(result.handoffTo).toBe('specialist');
  });
});
