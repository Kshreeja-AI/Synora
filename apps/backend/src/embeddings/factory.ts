import { getConfig } from '../config';
import { EmbeddingService } from './service';
import { initEmbeddingCache, resetEmbeddingCacheForTests } from './cache';
import { initRateLimiter, resetRateLimiterForTests } from './rateLimiter';
import { initCircuitBreakerRegistry, resetCircuitBreakerRegistryForTests } from './circuitBreaker';
import { initMetricsCollector, resetMetricsCollectorForTests } from './metrics';
import { initUsageAccountant, resetUsageAccountantForTests } from './usage';

/**
 * The composition root for the embeddings subsystem: reads `getConfig()`
 * and wires a fully-configured `EmbeddingService` from it, the same role
 * `../queue/manager.ts`'s `initialize()` plays for the queue subsystem.
 * `EmbeddingService` itself takes its dependencies as constructor
 * parameters and knows nothing about `getConfig()` — this is the only
 * place environment/config values are translated into concrete cache/
 * rate-limiter/circuit-breaker instances, so tests can construct a service
 * directly with fakes without ever touching this module.
 */
export function createEmbeddingService(): EmbeddingService {
  const config = getConfig().embeddings;

  const cache = initEmbeddingCache({
    backend: config.cache.backend,
    maxEntries: config.cache.maxEntries,
    redisUrl: config.cache.redisUrl,
  });

  const rateLimiter = initRateLimiter({
    backend: config.rateLimit.backend,
    requestsPerSecond: config.rateLimit.requestsPerSecond,
    redisUrl: config.rateLimit.redisUrl,
  });

  const circuitBreakers = initCircuitBreakerRegistry({
    failureThreshold: config.circuitBreaker.failureThreshold,
    cooldownMs: config.circuitBreaker.cooldownMs,
    halfOpenSuccessThreshold: config.circuitBreaker.halfOpenSuccessThreshold,
  });

  const metrics = initMetricsCollector();
  const usage = initUsageAccountant();

  return new EmbeddingService(
    cache,
    rateLimiter,
    circuitBreakers,
    metrics,
    usage,
    config.retry,
    { maxInputChars: config.security.maxInputChars, maxBatchRequestSize: config.security.maxBatchRequestSize },
    config.cache.ttlMs
  );
}

let embeddingService: EmbeddingService | null = null;

export function initEmbeddingService(): EmbeddingService {
  embeddingService = createEmbeddingService();
  return embeddingService;
}

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = createEmbeddingService();
  }
  return embeddingService;
}

export function resetEmbeddingServiceForTests(): void {
  embeddingService = null;
  // Reset every underlying singleton too, so cache/rate-limiter/circuit-
  // breaker/metrics/usage state from a previous test never leaks into the
  // next one via a stale module-level singleton.
  resetEmbeddingCacheForTests();
  resetRateLimiterForTests();
  resetCircuitBreakerRegistryForTests();
  resetMetricsCollectorForTests();
  resetUsageAccountantForTests();
}
