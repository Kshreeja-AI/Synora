import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PineconeProvider } from './pinecone.provider';

describe('PineconeProvider', () => {
  let provider: PineconeProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new PineconeProvider('test-index.svc.test.pinecone.io', 'test-key', 100);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and supports hybrid search', () => {
    expect(provider.id).toBe('pinecone');
    expect(provider.supportsHybridSearch).toBe(true);
  });

  it('upserts vectors with a computed namespace', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const result = await provider.upsert({
      workspaceId: 'ws-1',
      vectors: [{ id: 'v1', values: [0.1, 0.2], metadata: { a: 1 } }],
    });

    expect(result.upsertedCount).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test-index.svc.test.pinecone.io/vectors/upsert');
    expect(init.headers['Api-Key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.namespace).toBe('workspace:ws-1');
    expect(body.vectors[0].id).toBe('v1');
  });

  it('scopes the namespace to a sub-namespace when provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await provider.upsert({
      workspaceId: 'ws-1',
      namespace: 'documents',
      vectors: [{ id: 'v1', values: [0.1] }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.namespace).toBe('workspace:ws-1:documents');
  });

  it('queries and translates matches', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ matches: [{ id: 'v1', score: 0.95, metadata: { a: 1 } }] }),
    });

    const result = await provider.query({ workspaceId: 'ws-1', vector: [0.1, 0.2], topK: 5 });

    expect(result.matches).toEqual([{ id: 'v1', score: 0.95, values: undefined, metadata: { a: 1 } }]);
  });

  it('translates a generic MetadataFilter to Pinecone $-prefixed operators', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ matches: [] }) });

    await provider.query({
      workspaceId: 'ws-1',
      vector: [0.1],
      topK: 5,
      filter: { conversationId: { eq: 'conv-1' }, score: { gte: 0.5 } },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.filter).toEqual({ conversationId: { $eq: 'conv-1' }, score: { $gte: 0.5 } });
  });

  it('deletes by ids', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await provider.delete({ workspaceId: 'ws-1', ids: ['v1', 'v2'] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.ids).toEqual(['v1', 'v2']);
  });

  it('throws VectorDBProviderError on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'bad key' });

    await expect(provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [1] }] })).rejects.toThrow(
      'pinecone upsert failed'
    );
  });
});
