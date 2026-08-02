import Redis from 'ioredis'
import { logger } from '../../utils/logger'

/**
 * Pluggable storage for the memory subsystem's cache. Mirrors the pattern
 * already established in `../../embeddings/cache.ts`: an in-memory Map is
 * correct for a single backend instance, but every additional instance in a
 * horizontally-scaled deployment would otherwise get its own cold cache and
 * its own independent read load against Postgres — Redis is the
 * multi-instance-safe alternative.
 */
export interface CacheBackend {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(pattern: string): Promise<string[]>
  getStats(): Promise<{ size: number; hitRate: number; hits: number; misses: number }>
}

interface InMemoryRecord {
  value: unknown
  expiresAt: number
}

export class InMemoryCacheBackend implements CacheBackend {
  private readonly store = new Map<string, InMemoryRecord>()
  private hits = 0
  private misses = 0

  async get<T>(key: string): Promise<T | null> {
    const record = this.store.get(key)
    if (!record) {
      this.misses++
      return null
    }
    if (Date.now() > record.expiresAt) {
      this.store.delete(key)
      this.misses++
      return null
    }
    this.hits++
    return record.value as T
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
    this.hits = 0
    this.misses = 0
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`)
    return Array.from(this.store.keys()).filter((key) => regex.test(key))
  }

  async getStats(): Promise<{ size: number; hitRate: number; hits: number; misses: number }> {
    const total = this.hits + this.misses
    return {
      size: this.store.size,
      hitRate: total === 0 ? 0 : this.hits / total,
      hits: this.hits,
      misses: this.misses,
    }
  }
}

/**
 * Redis-backed cache. Uses its own dedicated `ioredis` connection rather
 * than importing `../../queue/redis.ts` or `../../workers/queue.ts`'s
 * connections — the memory subsystem is an independent sibling of the queue
 * subsystem (like `../../mail` and `../../storage`), and coupling one's
 * Redis lifecycle to the other's would make either impossible to disable or
 * reconfigure independently.
 *
 * Hit/miss counters are process-local (not stored in Redis): they exist to
 * answer "is this process's cache pulling its weight", the same question a
 * single-instance in-memory cache answers. Aggregating a cluster-wide hit
 * rate would need a dedicated metrics pipeline, not overloaded counter keys
 * mixed in with cached values.
 */
export class RedisCacheBackend implements CacheBackend {
  private hits = 0
  private misses = 0

  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key)
      if (raw === null) {
        this.misses++
        return null
      }
      this.hits++
      return JSON.parse(raw) as T
    } catch (error) {
      logger.warn('[MemoryCache] Redis get failed, treating as cache miss', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.misses++
      return null
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'PX', Math.max(1, Math.floor(ttlMs)))
    } catch (error) {
      logger.warn('[MemoryCache] Redis set failed, continuing without caching this entry', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (error) {
      logger.warn('[MemoryCache] Redis delete failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.scanKeys('memory:*')
      if (keys.length > 0) await this.client.del(...keys)
      this.hits = 0
      this.misses = 0
    } catch (error) {
      logger.warn('[MemoryCache] Redis clear failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.scanKeys(pattern)
    } catch (error) {
      logger.warn('[MemoryCache] Redis keys scan failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  async getStats(): Promise<{ size: number; hitRate: number; hits: number; misses: number }> {
    const total = this.hits + this.misses
    let size = 0
    try {
      size = (await this.scanKeys('memory:*')).length
    } catch {
      // size is a best-effort diagnostic; leave at 0 if Redis is unreachable
    }
    return {
      size,
      hitRate: total === 0 ? 0 : this.hits / total,
      hits: this.hits,
      misses: this.misses,
    }
  }

  /** SCAN, never KEYS — KEYS blocks the whole Redis instance on large keyspaces. */
  private async scanKeys(pattern: string): Promise<string[]> {
    const found: string[] = []
    let cursor = '0'
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
      found.push(...batch)
      cursor = nextCursor
    } while (cursor !== '0')
    return found
  }
}

function escapeRegex(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let backend: CacheBackend | null = null

/**
 * Redis-when-available, in-memory otherwise. Unlike the embeddings cache
 * (opt-in Redis via `EMBEDDING_CACHE_BACKEND=redis`), the memory subsystem
 * defaults to Redis whenever `REDIS_URL` is set: the app already depends on
 * Redis being reachable for its job queues (`../../workers/queue.ts`), so
 * there is no added deployment burden in also using it here, and a
 * horizontally-scaled deployment gets a correct shared cache without extra
 * configuration. Set `MEMORY_CACHE_BACKEND=memory` to force in-process
 * caching regardless (used by tests, and available for single-instance
 * deployments that would rather not share this cache over the network).
 */
export function resolveMemoryCacheBackend(): CacheBackend {
  if (backend) return backend

  const forced = process.env.MEMORY_CACHE_BACKEND
  const redisUrl = process.env.REDIS_URL

  if (forced !== 'memory' && redisUrl) {
    backend = new RedisCacheBackend(new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 }))
    logger.info('[MemoryCache] Using Redis-backed cache')
  } else {
    backend = new InMemoryCacheBackend()
    logger.info('[MemoryCache] Using in-memory cache (single instance only)')
  }

  return backend
}

export function resetMemoryCacheBackendForTests(): void {
  backend = null
}
