import { getEmbeddingService } from './factory';
import { EmbedOptions, EmbedStreamOptions } from './service';
import { EmbeddingBatchResult, EmbeddingResult, EmbeddingStreamChunk } from './types';

export type {
  EmbeddingVector,
  EmbeddingRequest,
  EmbeddingBatchRequest,
  EmbeddingUsage,
  EmbeddingResult,
  EmbeddingBatchResult,
  EmbeddingProvider,
  TextChunk,
  ChunkingStrategyName,
  ChunkingOptions,
  EmbeddingStreamChunk,
} from './types';
export {
  EmbeddingProviderError,
  NoEmbeddingProviderConfiguredError,
  EmbeddingProviderUnsupportedError,
  EmbeddingValidationError,
  EmbeddingRateLimitExceededError,
  EmbeddingCircuitOpenError,
} from './types';
export type { EmbeddingProviderDescriptor } from './descriptor';
export { EMBEDDING_PROVIDER_REGISTRY, getEmbeddingProviderDescriptor } from './registry';
export { resolveEmbeddingProvider } from './resolver';
export { chunkText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from './chunking';
export { EmbeddingService } from './service';
export type { EmbedOptions, EmbedStreamOptions } from './service';
export {
  createEmbeddingService,
  initEmbeddingService,
  getEmbeddingService,
  resetEmbeddingServiceForTests,
} from './factory';
export { getMetricsCollector as getEmbeddingMetricsCollector } from './metrics';
export type { EmbeddingProviderMetrics } from './metrics';
export { getUsageAccountant as getEmbeddingUsageAccountant } from './usage';
export type { WorkspaceEmbeddingUsage } from './usage';
export { getCircuitBreakerRegistry as getEmbeddingCircuitBreakerRegistry } from './circuitBreaker';
export type { CircuitState } from './circuitBreaker';
export { estimateEmbeddingCost } from './pricing';

/**
 * The one function most callers need: generate a single embedding. Every
 * production concern — provider selection, caching, rate limiting, retry,
 * circuit breaking, metrics, tracing, and cost/usage accounting — is
 * handled internally by `EmbeddingService`. No caller of this function
 * ever names a provider or imports a provider's SDK.
 */
export async function embed(text: string, options: EmbedOptions): Promise<EmbeddingResult> {
  return getEmbeddingService().embed(text, options);
}

export async function embedBatch(
  texts: readonly string[],
  options: EmbedOptions
): Promise<EmbeddingBatchResult> {
  return getEmbeddingService().embedBatch(texts, options);
}

export function embedStream(
  text: string,
  options: EmbedStreamOptions
): AsyncGenerator<EmbeddingStreamChunk> {
  return getEmbeddingService().embedStream(text, options);
}
