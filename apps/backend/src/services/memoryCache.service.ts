import { Memory } from '@synora/database'
import { logger } from '../utils/logger'

/**
 * In-memory cache implementation (mock Redis)
 * In production, replace with real Redis client
 */
class InMemoryCache {
  private cache = new Map<string, { value: any; expiresAt: number }>()
  private ttl = 15 * 60 * 1000 // 15 minutes default

  set(key: string, value: any, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.ttl)
    this.cache.set(key, { value, expiresAt })
  }

  get(key: string): any {
    const item = this.cache.get(key)

    if (!item) {
      return null
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return item.value
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  keys(pattern: string): string[] {
    const regex = new RegExp(pattern.replace('*', '.*'))
    return Array.from(this.cache.keys()).filter((key) => regex.test(key))
  }
}

export class MemoryCacheService {
  private cache = new InMemoryCache()
  private readonly MEMORY_PREFIX = 'memory:'
  private readonly SEARCH_PREFIX = 'memory:search:'
  private readonly WORKSPACE_PREFIX = 'memory:workspace:'
  private readonly STATS_PREFIX = 'memory:stats:'

  /**
   * Cache a memory
   */
  cacheMemory(memory: Memory, ttl: number = 15 * 60 * 1000): void {
    const key = `${this.MEMORY_PREFIX}${memory.id}`
    this.cache.set(key, memory, ttl)
  }

  /**
   * Get cached memory
   */
  getCachedMemory(memoryId: string): Memory | null {
    const key = `${this.MEMORY_PREFIX}${memoryId}`
    return this.cache.get(key)
  }

  /**
   * Cache memory search results
   */
  cacheSearchResults(
    workspaceId: string,
    query: string,
    results: { memories: Memory[]; total: number },
    ttl: number = 5 * 60 * 1000,
  ): void {
    const key = `${this.SEARCH_PREFIX}${workspaceId}:${this.hashQuery(query)}`
    this.cache.set(key, results, ttl)
  }

  /**
   * Get cached search results
   */
  getCachedSearchResults(
    workspaceId: string,
    query: string,
  ): { memories: Memory[]; total: number } | null {
    const key = `${this.SEARCH_PREFIX}${workspaceId}:${this.hashQuery(query)}`
    return this.cache.get(key)
  }

  /**
   * Cache workspace statistics
   */
  cacheWorkspaceStats(
    workspaceId: string,
    stats: any,
    ttl: number = 60 * 60 * 1000,
  ): void {
    const key = `${this.STATS_PREFIX}${workspaceId}`
    this.cache.set(key, stats, ttl)
  }

  /**
   * Get cached workspace statistics
   */
  getCachedWorkspaceStats(workspaceId: string): any {
    const key = `${this.STATS_PREFIX}${workspaceId}`
    return this.cache.get(key)
  }

  /**
   * Cache memory access pattern (for analytics)
   */
  recordMemoryAccess(memoryId: string, userId: string): void {
    const key = `${this.MEMORY_PREFIX}access:${memoryId}`
    const count = this.cache.get(key) || 0
    this.cache.set(key, count + 1, 60 * 60 * 1000) // 1 hour
  }

  /**
   * Invalidate memory cache
   */
  invalidateMemory(memoryId: string): void {
    const key = `${this.MEMORY_PREFIX}${memoryId}`
    this.cache.delete(key)
  }

  /**
   * Invalidate all search results for workspace
   */
  invalidateSearchResults(workspaceId: string): void {
    const pattern = `${this.SEARCH_PREFIX}${workspaceId}:*`
    const keys = this.cache.keys(pattern)
    keys.forEach((key) => this.cache.delete(key))
  }

  /**
   * Invalidate workspace statistics
   */
  invalidateWorkspaceStats(workspaceId: string): void {
    const key = `${this.STATS_PREFIX}${workspaceId}`
    this.cache.delete(key)
  }

  /**
   * Bulk invalidate after memory updates
   */
  invalidateWorkspace(workspaceId: string): void {
    this.invalidateSearchResults(workspaceId)
    this.invalidateWorkspaceStats(workspaceId)
  }

  /**
   * Warm cache with frequently accessed memories
   */
  async warmCache(memories: Memory[], ttl: number = 30 * 60 * 1000): Promise<void> {
    memories.forEach((memory) => {
      this.cacheMemory(memory, ttl)
    })

    logger.info(`Cache warmed with ${memories.length} memories`)
  }

  /**
   * Get cache size statistics
   */
  getStats(): { size: number; hitRate: number } {
    // Mock stats - in real Redis, query actual stats
    return {
      size: this.cache.keys('*').length,
      hitRate: 0.85, // Mock value
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.cache.clear()
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
