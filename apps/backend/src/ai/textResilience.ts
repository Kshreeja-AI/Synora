import { CircuitBreakerRegistry } from '../resilience/circuitBreaker';
import { withRetry, type RetryPolicyConfig } from '../resilience/retry';
import { withTimeout } from '../resilience/timeout';
import { AIProviderError } from './types';
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
 *   retry           — a single transient blip (network, 429, 5xx) is
 *                     absorbed within one call;
 *   timeout         — a stalled call becomes a classifiable failure
 *                     instead of an infinite wait.
 *
 * The breaker registry here is deliberately SEPARATE from the embeddings
 * stack's: a vendor's chat API and its embeddings API fail independently
 * in practice, and an outage in one must not fail-fast the other.
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

/** Breaker state is process-global; tests must not leak trips into each other. */
export function resetTextResilienceForTests(): void {
  breakers = new CircuitBreakerRegistry({
    failureThreshold: 5,
    cooldownMs: 30_000,
    halfOpenSuccessThreshold: 2,
  });
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
