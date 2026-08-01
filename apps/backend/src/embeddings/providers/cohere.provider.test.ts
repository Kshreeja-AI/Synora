import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CohereEmbeddingProvider } from './cohere.provider';

describe('CohereEmbeddingProvider', () => {
  let provider: CohereEmbeddingProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new CohereEmbeddingProvider('test-key', 'embed-english-v3.0');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and batch size', () => {
    expect(provider.id).toBe('cohere');
    expect(provider.maxBatchSize).toBe(96);
  });

  it('embeds a batch of texts and sends input_type: search_document', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        meta: { billed_units: { input_tokens: 8 } },
      }),
    });

    const result = await provider.embedBatch({ texts: ['a', 'b'], workspaceId: 'ws-1' });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].embedding.values).toEqual([0.1, 0.2]);
    expect(result.results[0].usage.tokens).toBe(4);

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.input_type).toBe('search_document');
  });

  it('throws EmbeddingProviderError on non-ok HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'rate limited',
    });

    await expect(provider.embed({ text: 'x', workspaceId: 'ws-1' })).rejects.toThrow(
      'cohere embedding generation failed'
    );
  });
});
