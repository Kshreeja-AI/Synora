import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  EmbeddingBatchRequest,
  EmbeddingBatchResult,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingRequest,
  EmbeddingResult,
} from '../types';
import type { EmbeddingProviderDescriptor } from '../descriptor';
import { postJson } from '../shared';

const COHERE_API_URL = 'https://api.cohere.com/v1/embed';

/** Cohere's documented per-request limit for its embeddings endpoint. */
const COHERE_MAX_BATCH_SIZE = 96;

interface CohereEmbeddingResponse {
  embeddings: number[][];
  meta?: { billed_units?: { input_tokens?: number } };
}

/**
 * Cohere exposes a plain REST API rather than a Node SDK, so this talks to
 * it directly via `fetch`. `input_type: 'search_document'` matches how this
 * application uses embeddings (indexing content for later semantic search)
 * — Cohere's v3 models require this hint and produce different vectors for
 * `search_query` vs `search_document`, unlike every other provider here.
 */
export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'cohere';
  readonly maxBatchSize = COHERE_MAX_BATCH_SIZE;

  constructor(
    private readonly apiKey: string,
    readonly defaultModel: string
  ) {}

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const batch = await this.embedBatch({
      texts: [request.text],
      workspaceId: request.workspaceId,
      model: request.model,
    });
    return batch.results[0];
  }

  async embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResult> {
    const model = request.model ?? this.defaultModel;

    try {
      const response = await postJson<CohereEmbeddingResponse>(
        COHERE_API_URL,
        { texts: [...request.texts], model, input_type: 'search_document' },
        { Authorization: `Bearer ${this.apiKey}` }
      );

      const totalTokens = response.meta?.billed_units?.input_tokens ?? 0;
      const perTextTokens = request.texts.length > 0 ? totalTokens / request.texts.length : 0;

      const results: EmbeddingResult[] = response.embeddings.map((values) => ({
        embedding: { values, dimensions: values.length },
        provider: this.id,
        model,
        usage: { tokens: perTextTokens },
        cached: false,
      }));

      return { results, provider: this.id, model };
    } catch (error) {
      throw new EmbeddingProviderError(
        `${this.id} embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const cohereEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'cohere',
  displayName: 'Cohere',
  async isConfigured() {
    return (await secretsManager.tryGet('COHERE_API_KEY', 'embeddings:cohere')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('COHERE_API_KEY', 'embeddings:cohere');
    return new CohereEmbeddingProvider(apiKey, getConfig().embeddings.cohereModel);
  },
};
