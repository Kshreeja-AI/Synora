import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import Redis from 'ioredis'
import {
  InMemoryCacheBackend,
  RedisCacheBackend,
  resolveMemoryCacheBackend,
  resetMemoryCacheBackendForTests,
} from '../backend'

describe('InMemoryCacheBackend', () => {
  let backend: InMemoryCacheBackend

  beforeEach(() => {
    backend = new InMemoryCacheBackend()
  })

  it('returns null for a missing key and counts it as a miss', async () => {
    expect(await backend.get('nope')).toBeNull()
    const stats = await backend.getStats()
    expect(stats.misses).toBe(1)
    expect(stats.hits).toBe(0)
  })

  it('stores and retrieves a value, counting it as a hit', async () => {
    await backend.set('key', { a: 1 }, 60_000)
    expect(await backend.get('key')).toEqual({ a: 1 })
    const stats = await backend.getStats()
    expect(stats.hits).toBe(1)
  })

  it('expires a value after its ttl', async () => {
    await backend.set('key', 'value', -1)
    expect(await backend.get('key')).toBeNull()
  })

  it('deletes a key', async () => {
    await backend.set('key', 'value', 60_000)
    await backend.delete('key')
    expect(await backend.get('key')).toBeNull()
  })

  it('matches keys by glob pattern', async () => {
    await backend.set('memory:search:ws-1:abc', 1, 60_000)
    await backend.set('memory:search:ws-1:def', 1, 60_000)
    await backend.set('memory:search:ws-2:abc', 1, 60_000)

    const keys = await backend.keys('memory:search:ws-1:*')
    expect(keys.sort()).toEqual(['memory:search:ws-1:abc', 'memory:search:ws-1:def'])
  })

  it('computes a real hit rate from actual hits/misses, never a fixed constant', async () => {
    await backend.set('a', 1, 60_000)
    await backend.get('a') // hit
    await backend.get('a') // hit
    await backend.get('missing') // miss

    const stats = await backend.getStats()
    expect(stats.hitRate).toBeCloseTo(2 / 3)
  })

  it('clear() resets both storage and hit-rate counters', async () => {
    await backend.set('a', 1, 60_000)
    await backend.get('a')
    await backend.clear()

    expect(await backend.get('a')).toBeNull()
    const stats = await backend.getStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(1) // the get() right above this counts as a miss
  })
})

/**
 * The tests below talk to a REAL Redis. They run only when REDIS_URL is set
 * (CI provisions a Redis service and sets it). On a laptop or sandbox without
 * one they are SKIPPED, with the reason in the suite name, instead of hanging
 * for 10s each and failing for a reason unrelated to the code. A skip means
 * NOT VERIFIED on that machine.
 */
const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL)

describe.skipIf(!REDIS_AVAILABLE)('RedisCacheBackend (real Redis; SKIPPED unless REDIS_URL is set = NOT VERIFIED)', () => {
  let client: Redis
  let backend: RedisCacheBackend

  beforeEach(async () => {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
    backend = new RedisCacheBackend(client)
    const keys = await client.keys('memory:*')
    if (keys.length > 0) await client.del(...keys)
  })

  afterAll(async () => {
    await client.quit()
  })

  it('stores and retrieves a JSON-serializable value via real Redis', async () => {
    await backend.set('memory:test-key', { memoryId: 'm1' }, 60_000)
    expect(await backend.get('memory:test-key')).toEqual({ memoryId: 'm1' })
  })

  it('returns null for a missing key', async () => {
    expect(await backend.get('memory:missing')).toBeNull()
  })

  it('respects ttl (PX) so an expired key is really gone from Redis', async () => {
    await backend.set('memory:short-lived', 'x', 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await backend.get('memory:short-lived')).toBeNull()
  })

  it('deletes a key', async () => {
    await backend.set('memory:to-delete', 'x', 60_000)
    await backend.delete('memory:to-delete')
    expect(await backend.get('memory:to-delete')).toBeNull()
  })

  it('scans for keys by pattern using SCAN, not KEYS', async () => {
    const scanSpy = vi.spyOn(client, 'scan')
    const keysSpy = vi.spyOn(client, 'keys')

    await backend.set('memory:pattern:a', 1, 60_000)
    await backend.set('memory:pattern:b', 1, 60_000)

    const keys = await backend.keys('memory:pattern:*')

    expect(keys.sort()).toEqual(['memory:pattern:a', 'memory:pattern:b'])
    expect(scanSpy).toHaveBeenCalled()
    expect(keysSpy).not.toHaveBeenCalled()
  })

  it('clear() removes only memory:* keys', async () => {
    await backend.set('memory:clear-me', 1, 60_000)
    await client.set('other:untouched', 'x')

    await backend.clear()

    expect(await backend.get('memory:clear-me')).toBeNull()
    expect(await client.get('other:untouched')).toBe('x')
    await client.del('other:untouched')
  })

  it('never fabricates a hit rate — reflects real gets against real Redis', async () => {
    await backend.set('memory:hr', 1, 60_000)
    await backend.get('memory:hr') // hit
    await backend.get('memory:hr-missing') // miss

    const stats = await backend.getStats()
    expect(stats.hitRate).toBeCloseTo(0.5)
  })
})

// Needs no Redis (it points at a dead port on purpose), so it always runs.
describe('RedisCacheBackend with an unreachable Redis', () => {
  it('degrades to a cache miss (not a thrown error) when Redis is unreachable', async () => {
    const brokenClient = new Redis({ port: 1, lazyConnect: true, maxRetriesPerRequest: 0 })
    const brokenBackend = new RedisCacheBackend(brokenClient)

    await expect(brokenBackend.get('memory:x')).resolves.toBeNull()
    await expect(brokenBackend.set('memory:x', 1, 1000)).resolves.toBeUndefined()

    brokenClient.disconnect()
  })
})

describe('resolveMemoryCacheBackend', () => {
  const originalRedisUrl = process.env.REDIS_URL
  const originalForced = process.env.MEMORY_CACHE_BACKEND

  beforeEach(() => {
    resetMemoryCacheBackendForTests()
  })

  afterAll(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = originalRedisUrl
    if (originalForced === undefined) delete process.env.MEMORY_CACHE_BACKEND
    else process.env.MEMORY_CACHE_BACKEND = originalForced
    resetMemoryCacheBackendForTests()
  })

  it('picks Redis when REDIS_URL is set and no override forces memory', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    delete process.env.MEMORY_CACHE_BACKEND

    const backend = resolveMemoryCacheBackend()
    expect(backend).toBeInstanceOf(RedisCacheBackend)
  })

  it('picks in-memory when MEMORY_CACHE_BACKEND=memory overrides an available REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.MEMORY_CACHE_BACKEND = 'memory'

    const backend = resolveMemoryCacheBackend()
    expect(backend).toBeInstanceOf(InMemoryCacheBackend)
  })

  it('picks in-memory when REDIS_URL is not set', () => {
    delete process.env.REDIS_URL
    delete process.env.MEMORY_CACHE_BACKEND

    const backend = resolveMemoryCacheBackend()
    expect(backend).toBeInstanceOf(InMemoryCacheBackend)
  })

  it('is a singleton across calls until reset', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    const first = resolveMemoryCacheBackend()
    const second = resolveMemoryCacheBackend()
    expect(first).toBe(second)
  })
})
