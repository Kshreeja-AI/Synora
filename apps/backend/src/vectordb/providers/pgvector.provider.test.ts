import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PgVectorProvider } from './pgvector.provider';

describe('PgVectorProvider', () => {
  let provider: PgVectorProvider;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    provider = new PgVectorProvider(mockClient, 3, 500);
  });

  it('has correct id and does not support hybrid search', () => {
    expect(provider.id).toBe('pgvector');
    expect(provider.supportsHybridSearch).toBe(false);
  });

  it('ensures the extension and table exist before the first operation', async () => {
    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1, 0.2, 0.3] }] });

    const unsafeCalls = mockClient.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
    expect(unsafeCalls.some((sql: string) => sql.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
    expect(unsafeCalls.some((sql: string) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });

  it('only ensures the table once across multiple operations', async () => {
    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1, 0.2, 0.3] }] });
    const callsAfterFirst = mockClient.$executeRawUnsafe.mock.calls.length;

    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v2', values: [0.4, 0.5, 0.6] }] });
    expect(mockClient.$executeRawUnsafe.mock.calls.length).toBe(callsAfterFirst);
  });

  it('upserts a vector via a parameterized INSERT ... ON CONFLICT', async () => {
    await provider.upsert({
      workspaceId: 'ws-1',
      vectors: [{ id: 'v1', values: [0.1, 0.2, 0.3], metadata: { conversationId: 'c1' } }],
    });

    expect(mockClient.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('queries using cosine distance and returns a similarity score', async () => {
    mockClient.$queryRaw.mockResolvedValueOnce([{ id: 'v1', score: 0.9, embedding: null, metadata: { a: 1 } }]);

    const result = await provider.query({ workspaceId: 'ws-1', vector: [0.1, 0.2, 0.3], topK: 5 });

    expect(result.matches).toEqual([{ id: 'v1', score: 0.9, values: undefined, metadata: { a: 1 } }]);
  });

  it('deletes by id list scoped to the computed namespace', async () => {
    await provider.delete({ workspaceId: 'ws-1', ids: ['v1', 'v2'] });
    expect(mockClient.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a metadata filter field with unsafe characters as a defense against SQL injection', async () => {
    await expect(
      provider.query({
        workspaceId: 'ws-1',
        vector: [0.1, 0.2, 0.3],
        topK: 5,
        filter: { 'bad field; DROP TABLE x': { eq: 'x' } },
      })
    ).rejects.toThrow('Invalid metadata filter field name');
  });

  it('wraps a client error in VectorDBProviderError', async () => {
    mockClient.$queryRaw.mockRejectedValueOnce(new Error('connection lost'));

    await expect(provider.query({ workspaceId: 'ws-1', vector: [0.1, 0.2, 0.3], topK: 5 })).rejects.toThrow(
      'pgvector query failed'
    );
  });
});
