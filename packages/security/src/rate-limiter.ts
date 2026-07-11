export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
}

interface Bucket {
  tokens: number;
  windowStart: number;
}

/**
 * Fixed-window in-process rate limiter — simple and sufficient for a
 * single gateway instance or local dev. For multi-instance
 * deployments, implement the same RateLimiter interface against Redis
 * (INCR + EXPIRE) so limits are enforced across the fleet, not per-pod.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
  ) {}

  consume(key: string): RateLimitDecision {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { tokens: 1, windowStart: now });
      return { allowed: true, remaining: this.limit - 1, resetAt: now + this.windowMs };
    }

    if (bucket.tokens >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.windowStart + this.windowMs };
    }

    bucket.tokens++;
    return {
      allowed: true,
      remaining: this.limit - bucket.tokens,
      resetAt: bucket.windowStart + this.windowMs,
    };
  }
}
