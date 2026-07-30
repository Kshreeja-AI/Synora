import OpenAI from 'openai';
import { getConfig } from '../../config';
import type { EmbeddingProviderDescriptor } from '../descriptor';
import { OpenAICompatibleEmbeddingProvider } from './openaiCompatible.provider';

/**
 * Generic self-hosted embedding engine. Deliberately targets the
 * OpenAI-compatible `/v1/embeddings` wire format rather than inventing a
 * bespoke protocol: it is the de facto standard that vLLM, Text Embeddings
 * Inference (TEI), LocalAI, and most self-hosted inference servers already
 * implement, so "self-hosted" here means "any OpenAI-compatible embeddings
 * server", not a specific engine. An organization running something that
 * doesn't speak this protocol can still integrate by placing a thin
 * translation proxy in front of it — the same accommodation every other
 * OpenAI-compatible provider in this codebase relies on.
 *
 * Activated by setting `EMBEDDING_SELF_HOSTED_BASE_URL`. An API key is
 * optional (self-hosted deployments behind a private network commonly have
 * none); when set, it is sent as a standard Bearer token.
 */
const SELF_HOSTED_DEFAULT_MAX_BATCH_SIZE = 64;

export const selfHostedEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'self-hosted',
  displayName: 'Self-Hosted',
  async isConfigured() {
    return Boolean(getConfig().embeddings.selfHostedBaseUrl);
  },
  async create() {
    const { selfHostedBaseUrl, selfHostedApiKey, selfHostedModel, selfHostedMaxBatchSize } =
      getConfig().embeddings;
    if (!selfHostedBaseUrl) {
      throw new Error('Self-hosted embeddings require EMBEDDING_SELF_HOSTED_BASE_URL to be set.');
    }
    return new OpenAICompatibleEmbeddingProvider(
      'self-hosted',
      new OpenAI({
        apiKey: selfHostedApiKey || 'self-hosted-does-not-require-an-api-key',
        baseURL: selfHostedBaseUrl,
      }),
      selfHostedModel,
      selfHostedMaxBatchSize ?? SELF_HOSTED_DEFAULT_MAX_BATCH_SIZE
    );
  },
};
