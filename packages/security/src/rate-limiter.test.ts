import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter.js';

describe('InMemoryRateLimiter', () => {
  it('allows requests up to the limit then blocks', () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    expect(limiter.consume('k1').allowed).toBe(true);
    expect(limiter.consume('k1').allowed).toBe(true);
    expect(limiter.consume('k1').allowed).toBe(true);
    const fourth = limiter.consume('k1');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('tracks separate buckets per key', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('b').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
  });
});
