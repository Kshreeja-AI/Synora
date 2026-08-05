import Redis from 'ioredis';
import { getConfig, ConfigNotInitializedError } from '../config';
import { CircuitBreakerRegistry } from '../resilience/circuitBreaker';
import { InMemoryRateLimiter, RedisRateLimiter, type RateLimiter } from '../resilience/rateLimiter';
import { withRetry, type RetryPolicyConfig } from '../resilience/retry';
import { withTimeout } from '../resilience/timeout';
import { AIProviderError, AIRateLimitedError } from './types';
import type { TextGenerationProvider, TextGenerationRequest, TextGenerationResult } from './types';

/**
 * The resilience wrapper for every text/code generation call.
 *
 * The provider readiness audit (docs/operations/PROVIDER_READINESS_MATRIX.md)
 * found the text path had NO timeout, NO retry and NO circuit breaking,
 * while the embeddings stack had all three. This module closes that gap
 * with the embeddings stack's own modules — moved to `src/resilience/`,
 * not copied, so the two stacks can never disagree about which failures
 * are transient or when a provider is "down".
 *
 * Layering, outermost first:
 *   circuit breaker — a provider failing for MINUTES fails fast instead
 *                     of making every user wait out a full retry cycle;
 *   rate limiter    — Synora paces its OWN outbound rate per provider
 *                     (configured from the vendor tier via AI_RATE_LIMIT_*),
 *                     so a runaway caller is refused here, cheaply and
 *                     honestly, instead of discovered as a vendor 429;
 *   retry           — a single transient blip (network, 429, 5xx) is
 *                     absorbed within one call;
 *   timeout         — a stalled call becomes a classifiable failure
 *                     instead of an infinite wait.
 *
 * The breaker registry and rate limiter here are deliberately SEPARATE
 * from the embeddings stack's: a vendor's chat API and its embeddings API
 * fail — and are quota'd — independently in practice, and an outage or
 * burst in one must not fail-fast or throttle the other.
 *
 * KNOWN LIMIT: the limiter keys by provider id alone. The embeddings stack
 * keys `provider:workspace` so one noisy workspace can't starve another,
 * but this facade deliberately hides caller identity from the provider
 * layer, so workspace fairness needs a facade contract change first —
 * tracked in docs/operations/PROVIDER_READINESS_MATRIX.md.
 */

const TEXT_RETRY: RetryPolicyConfig = {
  attempts: 3,
  backoffMs: 500,
  backoffStrategy: 'exponential',
};

/**
 * Generous by design: agent planning calls can legitimately run long.
 * This is an upper bound on pathology, not a performance target.
 */
const TEXT_TIMEOUT_MS = 120_000;

let breakers = new CircuitBreakerRegistry({
  failureThreshold: 5,
  cooldownMs: 30_000,
  halfOpenSuccessThreshold: 2,
});

let rateLimiter: RateLimiter | null = null;

/**
 * Lazily built from config on first use (module load must stay side-effect
 * free — tests import this file before any config exists). The instance is
 * the TEXT stack's own; the embeddings stack keeps its separate singleton
 * in `resilience/rateLimiter.ts`, because the two vendor API surfaces are
 * quota'd independently.
 */
function getTextRateLimiter(): RateLimiter {
  if (rateLimiter) return rateLimiter;

  let config: { backend: 'memory' | 'redis'; requestsPerSecond: number; redisUrl?: string };
  try {
    config = getConfig().ai.rateLimit;
  } catch (error) {
    if (!(error instanceof ConfigNotInitializedError)) throw error;
    // Production initializes config at boot before any request can arrive;
    // this branch exists for code that exercises the facade without a
    // booted app (unit tests, isolated scripts). Same shape as the
    // embeddings singleton's uninitialized fallback, at the schema default.
    config = { backend: 'memory', requestsPerSecond: 10 };
  }

  if (config.backend === 'redis') {
    if (!config.redisUrl) {
      throw new Error('AI_RATE_LIMIT_BACKEND=redis requires AI_RATE_LIMIT_REDIS_URL to be set.');
    }
    rateLimiter = new RedisRateLimiter(new Redis(config.redisUrl), config.requestsPerSecond);
  } else {
    rateLimiter = new InMemoryRateLimiter(config.requestsPerSecond, config.requestsPerSecond);
  }
  return rateLimiter;
}

/** Deterministic limiter injection so tests never depend on config or timing. */
export function setTextRateLimiterForTests(limiter: RateLimiter): void {
  rateLimiter = limiter;
}

/** Breaker/limiter state is process-global; tests must not leak trips into each other. */
export function resetTextResilienceForTests(): void {
  breakers = new CircuitBreakerRegistry({
    failureThreshold: 5,
    cooldownMs: 30_000,
    halfOpenSuccessThreshold: 2,
  });
  rateLimiter = null;
}

export async function generateWithResilience(
  provider: TextGenerationProvider,
  request: TextGenerationRequest,
): Promise<TextGenerationResult> {
  const breaker = breakers.get(provider.id);

  if (!breaker.canAttempt()) {
    // Failing fast is the honest response to a provider that has failed
    // repeatedly: the alternative is every request waiting out the full
    // timeout+retry cycle against an upstream that is known to be down.
    throw new AIProviderError(
      `Provider "${provider.id}" is temporarily unavailable after repeated failures. ` +
        'Calls resume automatically once it recovers.',
      provider.id,
    );
  }

  // One token per logical call (retries within a call don't re-acquire),
  // mirroring the embeddings stack exactly. A rejection here is Synora's
  // own pacing, not a provider failure — so it must never trip the
  // breaker, and it's thrown before the try block below to guarantee that.
  if (!(await getTextRateLimiter().tryAcquire(provider.id))) {
    throw new AIRateLimitedError(provider.id);
  }

  try {
    const result = await withRetry(
      () => withTimeout(provider.generateText(request), TEXT_TIMEOUT_MS, provider.id),
      TEXT_RETRY,
      { providerId: provider.id, operation: 'generateText' },
    );
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}
