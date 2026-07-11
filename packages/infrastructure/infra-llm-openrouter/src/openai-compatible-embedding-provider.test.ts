import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding-provider.js';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('OpenAiCompatibleEmbeddingProvider', () => {
  it('maps the embeddings response to an array of vectors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
    );
    const provider = new OpenAiCompatibleEmbeddingProvider({
      apiKey: 'key',
      baseUrl: 'https://example.com/v1',
      model: 'text-embedding-3-small',
      fetch: fetchMock,
    });

    const vectors = await provider.embed(['a', 'b']);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });
});
