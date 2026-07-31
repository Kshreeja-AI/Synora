/**
 * In-Memory Cache Provider for Memory System
 * Provides fast access to hot memories, supports Redis integration
 */

import { Memory, MemoryProvider } from '../types';

export class CacheMemoryProvider implements MemoryProvider {
  name = 'cache';
  type = 'cache' as const;
  private cache: Map<string, { data: Memory; expiresAt: number }> = new Map();

  constructor(
    private defaultTTL: number = 3600, // 1 hour
    private maxSize: number = 1000,
    private logger?: any
  ) {}

  /**
   * Cache a memory
   */
  async cache(memory: Memory, ttl: number = this.defaultTTL): Promise<void> {
    const expiresAt = Date.now() + ttl * 1000;
    this.cache.set(memory.id, { data: memory, expiresAt });

    // Evict oldest if cache is full
    if (this.cache.size > this.maxSize) {
      const oldest = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt
      )[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    this.logger?.debug('Memory cached', { memoryId: memory.id, ttl });
  }

  /**
   * Get memory from cache
   */
  async getFromCache(memoryId: string): Promise<Memory | null> {
    const entry = this.cache.get(memoryId);

    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(memoryId);
      return null;
    }

    return entry.data;
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(memoryId: string): Promise<void> {
    this.cache.delete(memoryId);
  }

  /**
   * Invalidate all entries for workspace
   */
  async invalidateWorkspace(workspaceId: string): Promise<number> {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.data.workspaceId === workspaceId) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hit: number; miss: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hit: 0, // Would need hit tracking
      miss: 0,
    };
  }
}
