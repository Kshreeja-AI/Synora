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

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

/** Voyage AI's documented per-request limit for its embeddings endpoint. */
const VOYAGE_MAX_BATCH_SIZE = 128;

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

/**
 * Voyage AI — the embedding provider Anthropic's own documentation
 * recommends in place of a native Claude embeddings endpoint (see
 * `./claude.provider.ts`). Voyage exposes a plain REST API rather than a
 * Node SDK, so this talks to it directly via `fetch` rather than pulling in
 * an SDK dependency for one endpoint.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'voyage';
  readonly maxBatchSize = VOYAGE_MAX_BATCH_SIZE;

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
      const response = await postJson<VoyageEmbeddingResponse>(
        VOYAGE_API_URL,
        { input: [...request.texts], model },
        { Authorization: `Bearer ${this.apiKey}` }
      );

      const perTextTokens =
        request.texts.length > 0 ? response.usage.total_tokens / request.texts.length : 0;

      const results: EmbeddingResult[] = [...response.data]
        .sort((a, b) => a.index - b.index)
        .map((item) => ({
          embedding: { values: item.embedding, dimensions: item.embedding.length },
          provider: this.id,
          model: response.model,
          usage: { tokens: perTextTokens },
          cached: false,
        }));

      return { results, provider: this.id, model: response.model };
    } catch (error) {
      throw new EmbeddingProviderError(
        `${this.id} embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const voyageEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'voyage',
  displayName: 'Voyage AI',
  async isConfigured() {
    return (await secretsManager.tryGet('VOYAGE_API_KEY', 'embeddings:voyage')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('VOYAGE_API_KEY', 'embeddings:voyage');
    return new VoyageEmbeddingProvider(apiKey, getConfig().embeddings.voyageModel);
  },
};
