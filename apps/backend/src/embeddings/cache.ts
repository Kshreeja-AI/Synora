import { createHash } from 'crypto';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { EmbeddingResult } from './types';

/**
 * Content-addressed cache for embedding results. Embeddings are pure
 * functions of (provider, model, text) — the same input always produces
 * the same vector — so caching by a hash of those three fields is always
 * safe to reuse, unlike caching a text-generation result.
 *
 * `workspaceId` is folded into the key even though it doesn't affect the
 * embedding itself: this is workspace isolation applied to the cache layer
 * specifically, so a cache implementation bug can never let one workspace's
 * cache lookups be satisfied by another workspace's stored vectors, and per-
 * workspace cache eviction/inspection is always possible.
 */
export function buildCacheKey(
  workspaceId: string,
  provider: string,
  model: string,
  text: string
): string {
  const hash = createHash('sha256').update(text).digest('hex');
  return `embed:${workspaceId}:${provider}:${model}:${hash}`;
}

export interface EmbeddingCacheEntry {
  result: EmbeddingResult;
  createdAt: number;
}

export interface EmbeddingCache {
  get(key: string): Promise<EmbeddingCacheEntry | null>;
  set(key: string, entry: EmbeddingCacheEntry, ttlMs: number): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

interface InMemoryCacheRecord {
  entry: EmbeddingCacheEntry;
  expiresAt: number;
}

/**
 * Default cache backend: a single process's in-memory Map with TTL
 * expiration and LRU-by-insertion-order eviction once `maxEntries` is
 * exceeded. Correct for a single backend instance; `RedisEmbeddingCache`
 * below is the multi-instance-safe alternative.
 */
export class InMemoryEmbeddingCache implements EmbeddingCache {
  private readonly store = new Map<string, InMemoryCacheRecord>();

  constructor(private readonly maxEntries: number) {}

  async get(key: string): Promise<EmbeddingCacheEntry | null> {
    const record = this.store.get(key);
    if (!record) return null;

    if (Date.now() > record.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Refresh insertion order so frequently-hit keys survive eviction.
    this.store.delete(key);
    this.store.set(key, record);
    return record.entry;
  }

  async set(key: string, entry: EmbeddingCacheEntry, ttlMs: number): Promise<void> {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { entry, expiresAt: Date.now() + ttlMs });
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }
}

/**
 * Redis-backed cache for deployments running multiple backend instances,
 * where an in-memory cache would give each instance its own cold cache and
 * its own independent spend on repeat embeddings. Uses its own dedicated
 * `ioredis` connection rather than importing `../queue/redis.ts`'s
 * singleton — the queue module and the embeddings module are independent
 * siblings (like `../mail` and `../storage`), and coupling one's Redis
 * lifecycle to the other's would make either impossible to disable or
 * reconfigure without affecting the other.
 */
export class RedisEmbeddingCache implements EmbeddingCache {
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<EmbeddingCacheEntry | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as EmbeddingCacheEntry;
    } catch (error) {
      logger.warn('[EmbeddingCache] Redis get failed, treating as cache miss', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async set(key: string, entry: EmbeddingCacheEntry, ttlMs: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(entry), 'PX', ttlMs);
    } catch (error) {
      logger.warn('[EmbeddingCache] Redis set failed, continuing without caching this entry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clear(): Promise<void> {
    const keys = await this.client.keys('embed:*');
    if (keys.length > 0) await this.client.del(...keys);
  }

  async size(): Promise<number> {
    const keys = await this.client.keys('embed:*');
    return keys.length;
  }
}

let embeddingCache: EmbeddingCache | null = null;

export function initEmbeddingCache(config: {
  backend: 'memory' | 'redis';
  maxEntries: number;
  redisUrl?: string;
}): EmbeddingCache {
  if (config.backend === 'redis') {
    if (!config.redisUrl) {
      throw new Error('Redis embedding cache backend requires EMBEDDING_CACHE_REDIS_URL to be set.');
    }
    embeddingCache = new RedisEmbeddingCache(new Redis(config.redisUrl));
  } else {
    embeddingCache = new InMemoryEmbeddingCache(config.maxEntries);
  }
  return embeddingCache;
}

export function getEmbeddingCache(): EmbeddingCache {
  if (!embeddingCache) {
    embeddingCache = new InMemoryEmbeddingCache(10_000);
  }
  return embeddingCache;
}

export function resetEmbeddingCacheForTests(): void {
  embeddingCache = null;
}
