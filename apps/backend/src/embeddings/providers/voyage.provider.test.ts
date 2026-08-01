import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VoyageEmbeddingProvider } from './voyage.provider';

describe('VoyageEmbeddingProvider', () => {
  let provider: VoyageEmbeddingProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new VoyageEmbeddingProvider('test-key', 'voyage-3');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and batch size', () => {
    expect(provider.id).toBe('voyage');
    expect(provider.maxBatchSize).toBe(128);
  });

  it('embeds a batch of texts', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'voyage-3',
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
        usage: { total_tokens: 20 },
      }),
    });

    const result = await provider.embedBatch({ texts: ['a', 'b'], workspaceId: 'ws-1' });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].embedding.values).toEqual([0.1, 0.2]);
    expect(result.results[0].usage.tokens).toBe(10);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
  });

  it('sorts results by index regardless of response order', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'voyage-3',
        data: [
          { index: 1, embedding: [1] },
          { index: 0, embedding: [0] },
        ],
        usage: { total_tokens: 2 },
      }),
    });

    const result = await provider.embedBatch({ texts: ['a', 'b'], workspaceId: 'ws-1' });

    expect(result.results[0].embedding.values).toEqual([0]);
    expect(result.results[1].embedding.values).toEqual([1]);
  });

  it('throws EmbeddingProviderError on non-ok HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid api key',
    });

    await expect(provider.embed({ text: 'x', workspaceId: 'ws-1' })).rejects.toThrow(
      'voyage embedding generation failed'
    );
  });
});
