/**
 * Regression test for the user-scoped cache key bug in MemoryCacheService.
 *
 * Before the fix, the search cache key was:
 *   `memory:search:${workspaceId}:${hash(queryString)}`
 * — the userId was NOT part of the key. Two users in the same workspace
 * searching the same query would share the same cache entry. User B
 * could read User A's private memories from the cache.
 *
 * After the fix, the key is:
 *   `memory:search:${workspaceId}:${hash(JSON.stringify(scope))}`
 * where scope includes userId, so each user has isolated cache entries.
 *
 * Red/fail without the fix: getCachedSearch for user-2 returns user-1's
 * results after setCachedSearch with user-1's scope and the same workspace
 * and query params.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Memory } from '@synora/database'
import { MemoryCacheService, MemorySearchCacheScope } from '../memoryCache.service'

// Use an in-memory cache backend so tests don't need Redis
vi.mock('./memoryCache/backend', () => {
  const store = new Map<string, unknown>()
  return {
    resolveMemoryCacheBackend: vi.fn().mockReturnValue({
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: unknown) => { store.set(key, value) },
      del: (key: string) => { store.delete(key) },
      keys: (pattern: string) =>
        [...store.keys()].filter((k) => k.startsWith(pattern.replace('*', ''))),
    }),
  }
})

vi.mock('../memoryCache/backend', () => {
  const store = new Map<string, unknown>()
  return {
    resolveMemoryCacheBackend: vi.fn().mockReturnValue({
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => { store.set(key, value) },
      del: async (key: string) => { store.delete(key) },
      keys: async (pattern: string) =>
        [...store.keys()].filter((k) => k.startsWith(pattern.replace(':*', ''))),
    }),
  }
})

function scope(userId: string): MemorySearchCacheScope {
  return {
    userId,
    tags: [],
    searchTerm: 'deploy',
    limit: 10,
    offset: 0,
    pinnedOnly: false,
    archivedOnly: false,
  }
}

const fakeResults = { memories: [{ id: 'mem-1' } as Memory], total: 1 }

describe('MemoryCacheService — user isolation', () => {
  let cache: MemoryCacheService

  beforeEach(() => {
    cache = new MemoryCacheService()
  })

  it('stores and retrieves a search result for a user', async () => {
    await cache.cacheSearchResults('ws-1', scope('user-1'), fakeResults)
    const hit = await cache.getCachedSearchResults('ws-1', scope('user-1'))
    expect(hit).toEqual(fakeResults)
  })

  it('user-2 cannot read user-1 cached search results in the same workspace', async () => {
    await cache.cacheSearchResults('ws-1', scope('user-1'), fakeResults)

    // user-2 uses the identical query params but a different userId
    const miss = await cache.getCachedSearchResults('ws-1', scope('user-2'))
    expect(miss).toBeNull()
  })

  it('user-1 results are not affected by user-2 caching different results', async () => {
    const user1Results = { memories: [{ id: 'user1-mem' } as Memory], total: 1 }
    const user2Results = { memories: [{ id: 'user2-mem' } as Memory], total: 1 }

    await cache.cacheSearchResults('ws-1', scope('user-1'), user1Results)
    await cache.cacheSearchResults('ws-1', scope('user-2'), user2Results)

    const user1Hit = await cache.getCachedSearchResults('ws-1', scope('user-1'))
    expect(user1Hit?.memories[0]?.id).toBe('user1-mem')

    const user2Hit = await cache.getCachedSearchResults('ws-1', scope('user-2'))
    expect(user2Hit?.memories[0]?.id).toBe('user2-mem')
  })
})
