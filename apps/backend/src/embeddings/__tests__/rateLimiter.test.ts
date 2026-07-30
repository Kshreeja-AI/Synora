import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryRateLimiter } from '../rateLimiter';

describe('InMemoryRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls up to capacity', async () => {
    const limiter = new InMemoryRateLimiter(10, 3);

    expect(await limiter.tryAcquire('key-1')).toBe(true);
    expect(await limiter.tryAcquire('key-1')).toBe(true);
    expect(await limiter.tryAcquire('key-1')).toBe(true);
  });

  it('rejects calls once capacity is exhausted', async () => {
    const limiter = new InMemoryRateLimiter(1, 1);

    expect(await limiter.tryAcquire('key-1')).toBe(true);
    expect(await limiter.tryAcquire('key-1')).toBe(false);
  });

  it('refills tokens over time', async () => {
    vi.useFakeTimers();
    const limiter = new InMemoryRateLimiter(10, 1); // 10 tokens/sec, capacity 1

    expect(await limiter.tryAcquire('key-1')).toBe(true);
    expect(await limiter.tryAcquire('key-1')).toBe(false);

    vi.advanceTimersByTime(200); // 0.2s * 10/s = 2 tokens refilled (capped at capacity 1)

    expect(await limiter.tryAcquire('key-1')).toBe(true);
  });

  it('tracks separate buckets per key (workspace/provider isolation)', async () => {
    const limiter = new InMemoryRateLimiter(1, 1);

    expect(await limiter.tryAcquire('provider-a:workspace-1')).toBe(true);
    expect(await limiter.tryAcquire('provider-a:workspace-1')).toBe(false);
    // A different workspace against the same provider has its own bucket.
    expect(await limiter.tryAcquire('provider-a:workspace-2')).toBe(true);
  });
});
