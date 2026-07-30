import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MilvusProvider } from './milvus.provider';

describe('MilvusProvider', () => {
  let provider: MilvusProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new MilvusProvider('http://localhost:19530', 'test-token', 500);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and does not support hybrid search', () => {
    expect(provider.id).toBe('milvus');
    expect(provider.supportsHybridSearch).toBe(false);
  });

  it('creates the collection when has() reports it does not exist', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { has: false } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // create
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // upsert

    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1, 0.2] }] });

    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.dimension).toBe(2);
    expect(createBody.metricType).toBe('COSINE');
  });

  it('skips collection creation when has() reports it already exists', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { has: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1] }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('builds a Milvus filter expression including the computed namespace', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { has: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1] }] });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await provider.query({
      workspaceId: 'ws-1',
      vector: [0.1],
      topK: 5,
      filter: { conversationId: { eq: 'c1' } },
    });

    const searchBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(searchBody.filter).toBe('namespace == "workspace:ws-1" && conversationId == "c1"');
  });

  it('parses search results including round-tripped metadata', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { has: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1] }] });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'v1', distance: 0.95, metadataJson: '{"a":1}' }] }),
    });

    const result = await provider.query({ workspaceId: 'ws-1', vector: [0.1], topK: 5 });
    expect(result.matches[0]).toEqual({ id: 'v1', score: 0.95, metadata: { a: 1 } });
  });

  it('deletes by id list using an `in` filter expression', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await provider.delete({ workspaceId: 'ws-1', ids: ['v1', 'v2'] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.filter).toBe('id in ["v1", "v2"]');
  });
});
