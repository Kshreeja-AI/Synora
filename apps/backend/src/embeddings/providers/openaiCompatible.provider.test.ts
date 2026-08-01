import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAICompatibleEmbeddingProvider } from './openaiCompatible.provider';

vi.mock('openai');

describe('OpenAICompatibleEmbeddingProvider', () => {
  let provider: OpenAICompatibleEmbeddingProvider;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          model: 'text-embedding-3-small',
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      },
    };

    provider = new OpenAICompatibleEmbeddingProvider('openai', mockClient, 'text-embedding-3-small', 2048);
  });

  it('has correct id and batch size', () => {
    expect(provider.id).toBe('openai');
    expect(provider.maxBatchSize).toBe(2048);
  });

  it('embeds a single text', async () => {
    const result = await provider.embed({ text: 'hello world', workspaceId: 'ws-1' });

    expect(result.embedding.values).toEqual([0.1, 0.2, 0.3]);
    expect(result.embedding.dimensions).toBe(3);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('text-embedding-3-small');
    expect(result.usage.tokens).toBe(5);
    expect(result.cached).toBe(false);
  });

  it('embeds a batch, preserving order by index', async () => {
    mockClient.embeddings.create.mockResolvedValueOnce({
      model: 'text-embedding-3-small',
      data: [
        { index: 1, embedding: [1, 1] },
        { index: 0, embedding: [0, 0] },
      ],
      usage: { prompt_tokens: 4, total_tokens: 4 },
    });

    const result = await provider.embedBatch({ texts: ['a', 'b'], workspaceId: 'ws-1' });

    expect(result.results[0].embedding.values).toEqual([0, 0]);
    expect(result.results[1].embedding.values).toEqual([1, 1]);
  });

  it('uses custom model when provided', async () => {
    await provider.embed({ text: 'hi', workspaceId: 'ws-1', model: 'text-embedding-3-large' });

    expect(mockClient.embeddings.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-large' })
    );
  });

  it('divides total tokens evenly across batch items', async () => {
    mockClient.embeddings.create.mockResolvedValueOnce({
      model: 'text-embedding-3-small',
      data: [
        { index: 0, embedding: [0] },
        { index: 1, embedding: [1] },
      ],
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const result = await provider.embedBatch({ texts: ['a', 'b'], workspaceId: 'ws-1' });

    expect(result.results[0].usage.tokens).toBe(5);
    expect(result.results[1].usage.tokens).toBe(5);
  });

  it('throws EmbeddingProviderError on SDK failure', async () => {
    mockClient.embeddings.create.mockRejectedValueOnce(new Error('rate limited'));

    await expect(provider.embed({ text: 'x', workspaceId: 'ws-1' })).rejects.toThrow(
      'openai embedding generation failed'
    );
  });
});
