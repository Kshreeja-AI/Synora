import Redis from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Rate limiting keyed by `${providerId}:${workspaceId}` — a single noisy
 * workspace can never exhaust another workspace's quota against a shared
 * provider, and a runaway caller against one provider never throttles calls
 * to a different one.
 */
export interface RateLimiter {
  /** Returns true if the call is allowed to proceed, false if it should be rejected. */
  tryAcquire(key: string): Promise<boolean>;
}

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Classic token-bucket limiter: `capacity` tokens refill continuously at
 * `refillPerSecond`, and each call consumes one. Correct for a single
 * process; `RedisRateLimiter` below is the multi-instance-safe alternative.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly refillPerSecond: number,
    private readonly capacity: number
  ) {}

  async tryAcquire(key: string): Promise<boolean> {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillMs: now };

    const elapsedSeconds = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }
}

/**
 * Fixed-window counter backed by Redis, for deployments running multiple
 * backend instances where an in-memory bucket would let each instance
 * independently admit up to its own full quota — `N` instances would then
 * jointly allow `N x` the intended rate. Uses its own dedicated `ioredis`
 * connection, same reasoning as `RedisEmbeddingCache` in `./cache.ts`.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly client: Redis,
    private readonly maxPerWindow: number,
    private readonly windowMs: number = 1000
  ) {}

  async tryAcquire(key: string): Promise<boolean> {
    try {
      const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / this.windowMs)}`;
      const count = await this.client.incr(windowKey);
      if (count === 1) {
        await this.client.pexpire(windowKey, this.windowMs);
      }
      return count <= this.maxPerWindow;
    } catch (error) {
      logger.warn('[RateLimiter] Redis rate limit check failed, failing open', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Failing open (allowing the call) rather than closed: a Redis outage
      // should degrade rate-limit precision, not take down embeddings
      // entirely — the retry/circuit-breaker layers already protect the
      // provider from being hammered if it's genuinely unhealthy.
      return true;
    }
  }
}

let rateLimiter: RateLimiter | null = null;

export function initRateLimiter(config: {
  backend: 'memory' | 'redis';
  requestsPerSecond: number;
  redisUrl?: string;
}): RateLimiter {
  if (config.backend === 'redis') {
    if (!config.redisUrl) {
      throw new Error('Redis rate limiter backend requires EMBEDDING_RATE_LIMIT_REDIS_URL to be set.');
    }
    rateLimiter = new RedisRateLimiter(new Redis(config.redisUrl), config.requestsPerSecond);
  } else {
    rateLimiter = new InMemoryRateLimiter(config.requestsPerSecond, config.requestsPerSecond);
  }
  return rateLimiter;
}

export function getRateLimiter(): RateLimiter {
  if (!rateLimiter) {
    rateLimiter = new InMemoryRateLimiter(100, 100);
  }
  return rateLimiter;
}

export function resetRateLimiterForTests(): void {
  rateLimiter = null;
}
