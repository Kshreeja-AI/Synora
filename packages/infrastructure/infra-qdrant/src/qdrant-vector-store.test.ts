import { describe, expect, it, vi } from 'vitest';
import { QdrantVectorStore } from './qdrant-vector-store.js';
import type { VectorClientLike } from './vector-client-like.js';

function makeFakeClient(): VectorClientLike {
  return {
    upsert: vi.fn(async () => undefined),
    search: vi.fn(async () => [{ id: 'doc-1', score: 0.92, payload: { title: 'Hello' } }]),
    deleteCollection: vi.fn(async () => undefined),
  };
}

describe('QdrantVectorStore', () => {
  it('maps VectorRecord upserts to the client point shape', async () => {
    const client = makeFakeClient();
    const store = new QdrantVectorStore(client);

    await store.upsert('docs', [{ id: 'doc-1', vector: [0.1, 0.2], metadata: { title: 'Hello' } }]);

    expect(client.upsert).toHaveBeenCalledWith('docs', {
      points: [{ id: 'doc-1', vector: [0.1, 0.2], payload: { title: 'Hello' } }],
    });
  });

  it('maps search hits to VectorMatch results', async () => {
    const store = new QdrantVectorStore(makeFakeClient());
    const matches = await store.query('docs', [0.1, 0.2], 5);
    expect(matches).toEqual([{ id: 'doc-1', score: 0.92, metadata: { title: 'Hello' } }]);
  });
});
