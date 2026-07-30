import { describe, it, expect, vi } from 'vitest';
import { calculateDelay, isRetryableError, withRetry } from '../retry';

describe('calculateDelay', () => {
  it('computes exponential backoff', () => {
    const config = { attempts: 4, backoffMs: 100, backoffStrategy: 'exponential' as const };
    expect(calculateDelay(1, config)).toBe(100);
    expect(calculateDelay(2, config)).toBe(200);
    expect(calculateDelay(3, config)).toBe(400);
  });

  it('computes fixed backoff', () => {
    const config = { attempts: 4, backoffMs: 100, backoffStrategy: 'fixed' as const };
    expect(calculateDelay(1, config)).toBe(100);
    expect(calculateDelay(3, config)).toBe(100);
  });
});

describe('isRetryableError', () => {
  it('identifies network-related errors as retryable', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('Request timeout'))).toBe(true);
    expect(isRetryableError(new Error('Service unavailable'))).toBe(true);
  });

  it('identifies transient HTTP status codes as retryable', () => {
    expect(isRetryableError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRetryableError(new Error('HTTP 503 Service Unavailable'))).toBe(true);
  });

  it('identifies validation/auth errors as non-retryable', () => {
    expect(isRetryableError(new Error('Invalid API key'))).toBe(false);
    expect(isRetryableError(new Error('Embedding text must be a non-empty string'))).toBe(false);
  });
});

describe('withRetry', () => {
  const noDelayConfig = { attempts: 3, backoffMs: 0, backoffStrategy: 'fixed' as const };

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, noDelayConfig, { providerId: 'openai', operation: 'embed' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error up to the configured attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, noDelayConfig, { providerId: 'openai', operation: 'embed' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a non-retryable error, without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid API key'));

    await expect(
      withRetry(fn, noDelayConfig, { providerId: 'openai', operation: 'embed' })
    ).rejects.toThrow('Invalid API key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting all attempts on a persistently retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(
      withRetry(fn, noDelayConfig, { providerId: 'openai', operation: 'embed' })
    ).rejects.toThrow('ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(noDelayConfig.attempts);
  });
});
