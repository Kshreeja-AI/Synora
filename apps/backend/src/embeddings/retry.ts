import { logger } from '../utils/logger';

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
        throw error;
      }

      const delay = calculateDelay(attempt, config);
      logger.warn('[EmbeddingRetry] Retrying after transient failure', {
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

  throw lastError;
}
