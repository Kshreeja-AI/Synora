import { type EmbeddingProvider, asAgentId, asTenantId } from '@synora/core';
import { describe, expect, it } from 'vitest';
import { InMemoryVectorStore } from './in-memory-vector-store.js';
import { VectorMemoryStore } from './vector-memory-store.js';

/** Deterministic fake embedder: encodes a short vocabulary as one-hot-ish vectors. */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const t = text.toLowerCase();
      return [
        t.includes('cat') ? 1 : 0,
        t.includes('dog') ? 1 : 0,
        t.includes('car') ? 1 : 0,
        0.01,
      ];
    });
  }
}

describe('VectorMemoryStore', () => {
  it('writes and retrieves memories scoped to tenant + agent', async () => {
    const store = new VectorMemoryStore(new InMemoryVectorStore(), new FakeEmbeddingProvider());
    const tenantId = asTenantId('tenant-a');
    const agentId = asAgentId('agent-a');

    await store.write({
      tenantId,
      agentId,
      kind: 'episodic',
      content: 'The user has a pet cat named Milo.',
    });
    await store.write({
      tenantId,
      agentId,
      kind: 'episodic',
      content: 'The user drives a red car.',
    });
    await store.write({
      tenantId: asTenantId('tenant-b'),
      agentId,
      kind: 'episodic',
      content: 'Different tenant has a cat too.',
    });

    const results = await store.search({
      tenantId,
      agentId,
      text: 'Tell me about the cat',
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.record.content).toContain('cat');
    expect(results.every((r) => r.record.tenantId === tenantId)).toBe(true);
  });

  it('forgets a memory by id', async () => {
    const vectorStore = new InMemoryVectorStore();
    const store = new VectorMemoryStore(vectorStore, new FakeEmbeddingProvider());
    const tenantId = asTenantId('tenant-a');
    const agentId = asAgentId('agent-a');

    const record = await store.write({ tenantId, agentId, kind: 'semantic', content: 'dog fact' });
    await store.forget(record.id);

    const results = await store.search({ tenantId, agentId, text: 'dog', topK: 5 });
    expect(results.find((r) => r.record.id === record.id)).toBeUndefined();
  });
});
