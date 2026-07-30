import OpenAI from 'openai';
import {
  EmbeddingBatchRequest,
  EmbeddingBatchResult,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingRequest,
  EmbeddingResult,
} from '../types';

/**
 * Generic adapter for any provider that exposes an OpenAI-compatible
 * embeddings endpoint (`POST /v1/embeddings`) — OpenAI itself, and
 * self-hosted engines that deliberately mirror OpenAI's wire format (Ollama,
 * vLLM, Text Embeddings Inference, LocalAI) all document exactly this
 * compatibility. One class, one set of tests; each provider's own file
 * (openai/ollama/self-hosted) only supplies its id, base URL, default model,
 * and batch-size limit. Mirrors `../../ai/providers/openaiCompatible.provider.ts`.
 */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(
    readonly id: string,
    private readonly client: OpenAI,
    readonly defaultModel: string,
    readonly maxBatchSize: number
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
      const response = await this.client.embeddings.create({
        model,
        input: [...request.texts],
      });

      const totalTokens = response.usage?.total_tokens ?? 0;
      const perTextTokens = request.texts.length > 0 ? totalTokens / request.texts.length : 0;

      const results: EmbeddingResult[] = response.data
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
