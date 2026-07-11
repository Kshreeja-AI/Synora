import {
  type AgentDefinition,
  type GenerateOptions,
  type GenerateResult,
  type ModelProvider,
  type ModelProviderRegistry,
  type StreamEvent,
  type WorkflowDefinition,
  asAgentId,
  asMessageId,
  asSessionId,
  asTenantId,
  asUserId,
} from '@synora/core';
import { InMemoryEventBus } from '@synora/event-bus';
import { InMemoryConversationStore } from '@synora/memory';
import { ToolRegistry } from '@synora/tools';
import { describe, expect, it } from 'vitest';
import { AgentDefinitionRegistry } from './agent-registry.js';
import { AgentRuntime } from './agent-runtime.js';
import { Orchestrator } from './orchestrator.js';

function textResult(text: string): GenerateResult {
  return {
    message: {
      id: asMessageId(`m-${Math.random()}`),
      role: 'assistant',
      content: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    },
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}

class EchoProvider implements ModelProvider {
  readonly capabilities = {
    streaming: false,
    toolCalling: false,
    vision: false,
    embeddings: false,
  };
  constructor(readonly id: string) {}
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content.find((c) => c.type === 'text');
    return textResult(`${this.id}: ${text && 'text' in text ? text.text : ''}`);
  }
  async *stream(): AsyncIterable<StreamEvent> {}
}

class TwoProviderRegistry implements ModelProviderRegistry {
  private readonly providers: Map<string, ModelProvider>;
  constructor(providers: ModelProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }
  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }
  get(id: string): ModelProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`unknown provider ${id}`);
    return p;
  }
  list(): ModelProvider[] {
    return Array.from(this.providers.values());
  }
}

describe('Orchestrator', () => {
  it('runs a sequence of two agents, threading output into input', async () => {
    const registry = new TwoProviderRegistry([
      new EchoProvider('researcher'),
      new EchoProvider('writer'),
    ]);
    const agentRegistry = new AgentDefinitionRegistry();

    const researcher: AgentDefinition = {
      id: asAgentId('researcher'),
      name: 'Researcher',
      description: '',
      instructions: 'research',
      providerId: 'researcher',
      model: 'test',
      tools: [],
      memoryEnabled: false,
    };
    const writer: AgentDefinition = {
      id: asAgentId('writer'),
      name: 'Writer',
      description: '',
      instructions: 'write',
      providerId: 'writer',
      model: 'test',
      tools: [],
      memoryEnabled: false,
    };
    agentRegistry.register(researcher);
    agentRegistry.register(writer);

    const runtime = new AgentRuntime({
      providerRegistry: registry,
      toolRegistry: new ToolRegistry(),
      conversationStore: new InMemoryConversationStore(),
      eventBus: new InMemoryEventBus(),
    });

    const orchestrator = new Orchestrator({
      agentRuntime: runtime,
      agentRegistry,
      eventBus: new InMemoryEventBus(),
    });

    const workflow: WorkflowDefinition = {
      id: 'wf1',
      name: 'research then write',
      entry: {
        kind: 'sequence',
        id: 'root',
        steps: [
          { kind: 'agent', id: 'step1', agentId: asAgentId('researcher') },
          { kind: 'agent', id: 'step2', agentId: asAgentId('writer') },
        ],
      },
    };

    const result = await orchestrator.run(workflow, 'topic: llms', {
      tenantId: asTenantId('t1'),
      userId: asUserId('u1'),
      sessionId: asSessionId('s1'),
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('writer:');
    expect(result.trace).toHaveLength(3); // root sequence + 2 agent steps
  });

  it('fans out parallel branches against the same input', async () => {
    const registry = new TwoProviderRegistry([new EchoProvider('a'), new EchoProvider('b')]);
    const agentRegistry = new AgentDefinitionRegistry();
    const agentA: AgentDefinition = {
      id: asAgentId('agentA'),
      name: 'A',
      description: '',
      instructions: '',
      providerId: 'a',
      model: 'test',
      tools: [],
      memoryEnabled: false,
    };
    const agentB: AgentDefinition = {
      id: asAgentId('agentB'),
      name: 'B',
      description: '',
      instructions: '',
      providerId: 'b',
      model: 'test',
      tools: [],
      memoryEnabled: false,
    };
    agentRegistry.register(agentA);
    agentRegistry.register(agentB);

    const runtime = new AgentRuntime({
      providerRegistry: registry,
      toolRegistry: new ToolRegistry(),
      conversationStore: new InMemoryConversationStore(),
      eventBus: new InMemoryEventBus(),
    });
    const orchestrator = new Orchestrator({
      agentRuntime: runtime,
      agentRegistry,
      eventBus: new InMemoryEventBus(),
    });

    const workflow: WorkflowDefinition = {
      id: 'wf2',
      name: 'fan out',
      entry: {
        kind: 'parallel',
        id: 'root',
        branches: [
          { kind: 'agent', id: 'branchA', agentId: asAgentId('agentA') },
          { kind: 'agent', id: 'branchB', agentId: asAgentId('agentB') },
        ],
      },
    };

    const result = await orchestrator.run(workflow, 'ping', {
      tenantId: asTenantId('t1'),
      userId: asUserId('u1'),
      sessionId: asSessionId('s2'),
    });

    expect(result.status).toBe('completed');
    expect(result.output).toEqual(['a: ping', 'b: ping']);
  });
});
