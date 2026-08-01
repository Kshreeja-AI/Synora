import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiEmbeddingProvider } from './gemini.provider';

vi.mock('@google/generative-ai');

describe('GeminiEmbeddingProvider', () => {
  let provider: GeminiEmbeddingProvider;
  let mockClient: any;
  let mockModel: any;

  beforeEach(() => {
    mockModel = {
      batchEmbedContents: vi.fn().mockResolvedValue({
        embeddings: [{ values: [0.1, 0.2] }],
      }),
    };
    mockClient = { getGenerativeModel: vi.fn().mockReturnValue(mockModel) };

    provider = new GeminiEmbeddingProvider(mockClient, 'text-embedding-004');
  });

  it('has correct id and batch size', () => {
    expect(provider.id).toBe('gemini');
    expect(provider.maxBatchSize).toBe(100);
  });

  it('embeds a single text', async () => {
    const result = await provider.embed({ text: 'hello', workspaceId: 'ws-1' });

    expect(result.embedding.values).toEqual([0.1, 0.2]);
    expect(result.embedding.dimensions).toBe(2);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('text-embedding-004');
    // No token usage is reported by the API, so it's estimated from length.
    expect(result.usage.tokens).toBeGreaterThan(0);
  });

  it('embeds a batch preserving input order', async () => {
    mockModel.batchEmbedContents.mockResolvedValueOnce({
      embeddings: [{ values: [1] }, { values: [2] }],
    });

    const result = await provider.embedBatch({ texts: ['a', 'b'], workspaceId: 'ws-1' });

    expect(result.results[0].embedding.values).toEqual([1]);
    expect(result.results[1].embedding.values).toEqual([2]);
  });

  it('uses custom model when provided', async () => {
    await provider.embed({ text: 'hi', workspaceId: 'ws-1', model: 'custom-model' });

    expect(mockClient.getGenerativeModel).toHaveBeenCalledWith({ model: 'custom-model' });
  });

  it('throws EmbeddingProviderError on SDK failure', async () => {
    mockModel.batchEmbedContents.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(provider.embed({ text: 'x', workspaceId: 'ws-1' })).rejects.toThrow(
      'Gemini embedding generation failed'
    );
  });
});
