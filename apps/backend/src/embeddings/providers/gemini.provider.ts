import { GoogleGenerativeAI } from '@google/generative-ai';
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
import { estimateTokensFromChars } from '../shared';

/**
 * Google's `batchEmbedContents` accepts up to 100 requests per call — this
 * is Google's own documented limit for the Generative Language API.
 */
const GEMINI_MAX_BATCH_SIZE = 100;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'gemini';
  readonly maxBatchSize = GEMINI_MAX_BATCH_SIZE;

  constructor(
    private readonly client: GoogleGenerativeAI,
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
    const modelName = request.model ?? this.defaultModel;

    try {
      const model = this.client.getGenerativeModel({ model: modelName });

      // The Generative Language API's own token counter is not exposed on
      // embedding responses (unlike `generateContent`'s usageMetadata), so
      // token usage here is estimated from character count — documented in
      // `estimateTokensFromChars` — rather than fabricated as an exact number.
      const response = await model.batchEmbedContents({
        requests: request.texts.map((text) => ({
          content: { role: 'user', parts: [{ text }] },
          model: modelName,
        })),
      });

      const results: EmbeddingResult[] = response.embeddings.map((embedding, i) => ({
        embedding: { values: embedding.values, dimensions: embedding.values.length },
        provider: this.id,
        model: modelName,
        usage: { tokens: estimateTokensFromChars(request.texts[i].length) },
        cached: false,
      }));

      return { results, provider: this.id, model: modelName };
    } catch (error) {
      throw new EmbeddingProviderError(
        `Gemini embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const geminiEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'gemini',
  displayName: 'Google Gemini',
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('GOOGLE_AI_API_KEY', 'embeddings:gemini');
  },
  async create() {
    const apiKey = await secretsManager.get('GOOGLE_AI_API_KEY', 'embeddings:gemini');
    return new GeminiEmbeddingProvider(new GoogleGenerativeAI(apiKey), getConfig().embeddings.geminiModel);
  },
};
