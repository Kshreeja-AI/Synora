import { logger } from '../utils/logger';

/**
 * Shared provider-call resilience: retry with backoff.
 *
 * MOVED HERE FROM `embeddings/retry.ts` (which now re-exports this file)
 * so the text-generation stack and the embeddings stack run the SAME
 * retry logic. Two copies of "which errors are worth retrying" would
 * drift, and a text call and an embedding call disagreeing about whether
 * a 503 is transient is exactly the kind of quiet inconsistency that is
 * impossible to debug from the outside.
 */

export interface RetryPolicyConfig {
  attempts: number;
  backoffMs: number;
  backoffStrategy: 'exponential' | 'fixed';
}

const RETRYABLE_PATTERNS = [
  'econnrefused',
  'enotfound',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'timeout',
  'network',
  'unavailable',
  'temporarily',
  // HTTP status codes that indicate a transient upstream condition rather
  // than a permanent client error (a 429 rate limit or 5xx server error is
  // worth retrying; a 400/401/404 is not — retrying it would only repeat
  // the same failure).
  '429',
  '500',
  '502',
  '503',
  '504',
];

export function isRetryableError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

export function calculateDelay(attemptNumber: number, config: RetryPolicyConfig): number {
  if (config.backoffStrategy === 'fixed') return config.backoffMs;
  return config.backoffMs * Math.pow(2, attemptNumber - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const attemptsByError = new WeakMap<object, number>();

/**
 * Runs `fn`, retrying on retryable errors with exponential/fixed backoff up
 * to `config.attempts` total attempts. Non-retryable errors (a validation
 * error, an auth failure, an unsupported-provider error) are rethrown
 * immediately on first failure — retrying them would only waste latency
 * repeating a failure that will never succeed.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryPolicyConfig,
  context: { providerId: string; operation: string }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= config.attempts;
      if (isLastAttempt || !isRetryableError(error)) {
        // Tagged before rethrowing so a spend guard upstream can charge for
        // the invocations that may already have billed. See attemptsMadeFor.
        if (typeof error === 'object' && error !== null) {
          attemptsByError.set(error, attempt);
        }
        throw error;
      }

      const delay = calculateDelay(attempt, config);
      logger.warn('[ProviderRetry] Retrying after transient failure', {
        providerId: context.providerId,
        operation: context.operation,
        attempt,
        maxAttempts: config.attempts,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delay);
    }
  }

  if (typeof lastError === 'object' && lastError !== null) {
    attemptsByError.set(lastError, config.attempts);
  }
  throw lastError;
}

/**
 * How many provider invocations a failed call actually made.
 *
 * WHY THIS IS RECORDED. `withTimeout` stops Synora WAITING; it cannot
 * cancel the upstream HTTP request (its own header says so), so a timed-out
 * generation may still complete and bill. The retry loop then tries again.
 * Three attempts can therefore bill three times while the caller sees one
 * failure — and a spend guard that charges nothing for failures would treat
 * all of it as free, which is the one direction a cost cap must never err.
 *
 * A WeakMap rather than a property on the error: errors get logged,
 * serialized and compared, and adding a field to them changes shapes that
 * other code already depends on. This keeps the accounting fact beside the
 * error without altering the error itself.
 */
export function attemptsMadeFor(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null ? attemptsByError.get(error) : undefined;
}

export function recordAttemptsForTesting(error: object, attempts: number): void {
  attemptsByError.set(error, attempts);
}
