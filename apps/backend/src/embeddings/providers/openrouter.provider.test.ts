import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleEmbeddingProvider } from './openaiCompatible.provider';

describe('OpenRouter embedding routing', () => {
  it('uses the embeddings API and preserves a selected catalog model id', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'liquid/lfm-2.5-embedding-350m:free',
      data: [{ index: 0, embedding: [0.25, -0.5] }],
      usage: { total_tokens: 4 },
    });
    const provider = new OpenAICompatibleEmbeddingProvider(
      'openrouter',
      { embeddings: { create } } as never,
      'nvidia/nemotron-3-embed-1b:free',
      64
    );

    const result = await provider.embed({
      text: 'retrieval query',
      workspaceId: 'workspace-1',
      model: 'liquid/lfm-2.5-embedding-350m:free',
    });

    expect(create).toHaveBeenCalledWith({
      model: 'liquid/lfm-2.5-embedding-350m:free',
      input: ['retrieval query'],
    });
    expect(result).toMatchObject({
      provider: 'openrouter',
      model: 'liquid/lfm-2.5-embedding-350m:free',
      embedding: { values: [0.25, -0.5], dimensions: 2 },
    });
  });
});
