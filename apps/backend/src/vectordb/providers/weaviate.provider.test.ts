import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WeaviateProvider } from './weaviate.provider';

describe('WeaviateProvider', () => {
  let provider: WeaviateProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new WeaviateProvider('http://localhost:8080', 'test-key', 200);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and does not support hybrid search', () => {
    expect(provider.id).toBe('weaviate');
    expect(provider.supportsHybridSearch).toBe(false);
  });

  it('upserts via the batch objects endpoint with the computed namespace', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    await provider.upsert({
      workspaceId: 'ws-1',
      vectors: [{ id: 'v1', values: [0.1, 0.2], metadata: { conversationId: 'c1' } }],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8080/v1/batch/objects');
    const body = JSON.parse(init.body);
    expect(body.objects[0].properties.namespace).toBe('workspace:ws-1');
    expect(body.objects[0].properties.conversationId).toBe('c1');
    expect(JSON.parse(body.objects[0].properties.metadataJson)).toEqual({ conversationId: 'c1' });
  });

  it('queries via GraphQL and converts distance to a similarity score', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          Get: {
            SynoraVector: [
              {
                _additional: { id: 'v1', distance: 0.2 },
                namespace: 'workspace:ws-1',
                workspaceId: 'ws-1',
                metadataJson: '{"conversationId":"c1"}',
              },
            ],
          },
        },
      }),
    });

    const result = await provider.query({ workspaceId: 'ws-1', vector: [0.1, 0.2], topK: 5 });

    expect(result.matches[0].id).toBe('v1');
    expect(result.matches[0].score).toBeCloseTo(0.8); // 1 - distance
    expect(result.matches[0].metadata).toEqual({ conversationId: 'c1' });
  });

  it('surfaces GraphQL errors as a VectorDBProviderError', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'invalid query' }] }),
    });

    await expect(provider.query({ workspaceId: 'ws-1', vector: [0.1], topK: 5 })).rejects.toThrow(
      'weaviate query failed'
    );
  });

  it('deletes individual objects by id', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    await provider.delete({ workspaceId: 'ws-1', ids: ['v1', 'v2'] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/objects/SynoraVector/v1');
  });
});
