import { Memory } from '@synora/database'
import { logger } from '../utils/logger'
import { CacheBackend, resolveMemoryCacheBackend } from './memoryCache/backend'

export class MemoryCacheService {
  private readonly MEMORY_PREFIX = 'memory:'
  private readonly SEARCH_PREFIX = 'memory:search:'
  private readonly STATS_PREFIX = 'memory:stats:'

  constructor(private readonly cache: CacheBackend = resolveMemoryCacheBackend()) {}

  /**
   * Cache a memory
   */
  async cacheMemory(memory: Memory, ttl: number = 15 * 60 * 1000): Promise<void> {
    const key = `${this.MEMORY_PREFIX}${memory.id}`
    await this.cache.set(key, memory, ttl)
  }

  /**
   * Get cached memory
   */
  async getCachedMemory(memoryId: string): Promise<Memory | null> {
    const key = `${this.MEMORY_PREFIX}${memoryId}`
    return this.cache.get<Memory>(key)
  }

  /**
   * Cache memory search results
   */
  async cacheSearchResults(
    workspaceId: string,
    query: string,
    results: { memories: Memory[]; total: number },
    ttl: number = 5 * 60 * 1000,
  ): Promise<void> {
    const key = `${this.SEARCH_PREFIX}${workspaceId}:${this.hashQuery(query)}`
    await this.cache.set(key, results, ttl)
  }

  /**
   * Get cached search results
   */
  async getCachedSearchResults(
    workspaceId: string,
    query: string,
  ): Promise<{ memories: Memory[]; total: number } | null> {
    const key = `${this.SEARCH_PREFIX}${workspaceId}:${this.hashQuery(query)}`
    return this.cache.get<{ memories: Memory[]; total: number }>(key)
  }

  /**
   * Cache workspace statistics
   */
  async cacheWorkspaceStats(
    workspaceId: string,
    stats: unknown,
    ttl: number = 60 * 60 * 1000,
  ): Promise<void> {
    const key = `${this.STATS_PREFIX}${workspaceId}`
    await this.cache.set(key, stats, ttl)
  }

  /**
   * Get cached workspace statistics
   */
  async getCachedWorkspaceStats(workspaceId: string): Promise<unknown> {
    const key = `${this.STATS_PREFIX}${workspaceId}`
    return this.cache.get(key)
  }

  /**
   * Cache memory access pattern (for analytics)
   */
  async recordMemoryAccess(memoryId: string, _userId: string): Promise<void> {
    const key = `${this.MEMORY_PREFIX}access:${memoryId}`
    const count = (await this.cache.get<number>(key)) || 0
    await this.cache.set(key, count + 1, 60 * 60 * 1000) // 1 hour
  }

  /**
   * Invalidate memory cache
   */
  async invalidateMemory(memoryId: string): Promise<void> {
    const key = `${this.MEMORY_PREFIX}${memoryId}`
    await this.cache.delete(key)
  }

  /**
   * Invalidate all search results for workspace
   */
  async invalidateSearchResults(workspaceId: string): Promise<void> {
    const pattern = `${this.SEARCH_PREFIX}${workspaceId}:*`
    const keys = await this.cache.keys(pattern)
    await Promise.all(keys.map((key) => this.cache.delete(key)))
  }

  /**
   * Invalidate workspace statistics
   */
  async invalidateWorkspaceStats(workspaceId: string): Promise<void> {
    const key = `${this.STATS_PREFIX}${workspaceId}`
    await this.cache.delete(key)
  }

  /**
   * Bulk invalidate after memory updates
   */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    await Promise.all([
      this.invalidateSearchResults(workspaceId),
      this.invalidateWorkspaceStats(workspaceId),
    ])
  }

  /**
   * Warm cache with frequently accessed memories
   */
  async warmCache(memories: Memory[], ttl: number = 30 * 60 * 1000): Promise<void> {
    await Promise.all(memories.map((memory) => this.cacheMemory(memory, ttl)))
    logger.info(`Cache warmed with ${memories.length} memories`)
  }

  async getStats(): Promise<{ size: number; hitRate: number; hits: number; misses: number }> {
    return this.cache.getStats()
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    await this.cache.clear()
    logger.info('Memory cache cleared')
  }

  /**
   * Private: Hash query string for cache key
   */
  private hashQuery(query: string): string {
    let hash = 0
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }
}

export const memoryCacheService = new MemoryCacheService()
