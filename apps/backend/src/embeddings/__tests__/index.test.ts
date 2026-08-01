import { describe, it, expect, beforeEach, vi } from 'vitest';
import { embed, embedBatch, embedStream } from '../index';
import { getEmbeddingService } from '../factory';

vi.mock('../factory', () => ({
  getEmbeddingService: vi.fn(),
}));

describe('top-level embeddings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embed() resolves the service and delegates to it', async () => {
    const mockService = {
      embed: vi.fn().mockResolvedValue({
        embedding: { values: [0.1], dimensions: 1 },
        provider: 'openai',
        model: 'text-embedding-3-small',
        usage: { tokens: 5 },
        cached: false,
      }),
    };
    (getEmbeddingService as any).mockReturnValue(mockService);

    const result = await embed('hello', { workspaceId: 'ws-1' });

    expect(result.provider).toBe('openai');
    expect(mockService.embed).toHaveBeenCalledWith('hello', { workspaceId: 'ws-1' });
  });

  it('embedBatch() resolves the service and delegates to it', async () => {
    const mockService = {
      embedBatch: vi.fn().mockResolvedValue({
        results: [],
        provider: 'openai',
        model: 'text-embedding-3-small',
      }),
    };
    (getEmbeddingService as any).mockReturnValue(mockService);

    await embedBatch(['a', 'b'], { workspaceId: 'ws-1' });

    expect(mockService.embedBatch).toHaveBeenCalledWith(['a', 'b'], { workspaceId: 'ws-1' });
  });

  it('embedStream() resolves the service and delegates to it', async () => {
    async function* fakeStream() {
      yield {
        chunk: { text: 'a', index: 0, startOffset: 0, endOffset: 1 },
        totalChunks: 1,
        result: {
          embedding: { values: [1], dimensions: 1 },
          provider: 'openai',
          model: 'text-embedding-3-small',
          usage: { tokens: 1 },
          cached: false,
        },
      };
    }
    const mockService = { embedStream: vi.fn().mockReturnValue(fakeStream()) };
    (getEmbeddingService as any).mockReturnValue(mockService);

    const chunks = [];
    for await (const chunk of embedStream('a', { workspaceId: 'ws-1' })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(mockService.embedStream).toHaveBeenCalledWith('a', { workspaceId: 'ws-1' });
  });
});
