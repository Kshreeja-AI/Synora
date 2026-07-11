import type { EmbeddingProvider } from '@synora/application';
import { InfrastructureError } from '@synora/errors';
import type { FetchLike } from './fetch-like.js';

export interface OpenAiCompatibleEmbeddingProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: FetchLike;
}

interface EmbeddingsResponse {
  data: Array<{ embedding: number[] }>;
}

/** EmbeddingProvider adapter for DEFAULT_EMBEDDING_PROVIDER=openai-compatible. */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: OpenAiCompatibleEmbeddingProviderOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const response = await this.fetchFn(`${this.options.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.options.model, input: texts }),
    });

    if (!response.ok) {
      throw new InfrastructureError(`Embedding request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as EmbeddingsResponse;
    return payload.data.map((item) => item.embedding);
  }
}
