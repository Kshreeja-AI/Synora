import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QdrantProvider } from './qdrant.provider';

describe('QdrantProvider', () => {
  let provider: QdrantProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new QdrantProvider('http://localhost:6333', 'test-key', 500);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and does not support hybrid search', () => {
    expect(provider.id).toBe('qdrant');
    expect(provider.supportsHybridSearch).toBe(false);
  });

  it('ensures the collection exists before the first upsert, then skips the check on subsequent calls', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // GET collection exists
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // PUT points

    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1, 0.2] }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // PUT points only
    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v2', values: [0.3, 0.4] }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('creates the collection with the vector dimensionality when it does not exist', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404 }) // GET collection missing
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // PUT create collection
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // PUT points

    await provider.upsert({ workspaceId: 'ws-1', vectors: [{ id: 'v1', values: [0.1, 0.2, 0.3] }] });

    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.vectors).toEqual({ size: 3, distance: 'Cosine' });
  });

  it('embeds the computed namespace into point payloads', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    await provider.upsert({
      workspaceId: 'ws-1',
      namespace: 'documents',
      vectors: [{ id: 'v1', values: [0.1], metadata: { conversationId: 'c1' } }],
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.points[0].payload).toMatchObject({ conversationId: 'c1', _namespace: 'workspace:ws-1:documents' });
  });

  it('queries and strips the internal namespace field from returned metadata', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: [{ id: 'v1', score: 0.9, payload: { conversationId: 'c1', _namespace: 'workspace:ws-1' } }] }),
    });

    const result = await provider.query({ workspaceId: 'ws-1', vector: [0.1], topK: 5 });

    expect(result.matches[0].metadata).toEqual({ conversationId: 'c1' });
  });

  it('always includes a namespace match clause in the search filter', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [] }) });

    await provider.query({ workspaceId: 'ws-1', vector: [0.1], topK: 5 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.filter.must).toContainEqual({ key: '_namespace', match: { value: 'workspace:ws-1' } });
  });

  it('throws VectorDBProviderError on HTTP failure during query', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error', text: async () => 'oops' });

    await expect(provider.query({ workspaceId: 'ws-1', vector: [0.1], topK: 5 })).rejects.toThrow(
      'qdrant query failed'
    );
  });
});
