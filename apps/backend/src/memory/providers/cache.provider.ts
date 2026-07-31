/**
 * Memory Cache Provider
 * In-process TTL + LRU-by-insertion-order cache for hot memory reads,
 * with the MemoryCache table as a crash-recoverable backup (mirrors the
 * pattern in embeddings/cache.ts). Redis-ready: swap the in-memory Map
 * for an ioredis client behind the same MemoryProvider interface once
 * Redis is wired into the app (see CLAUDE.md — provisioned, not consumed
 * yet).
 */

import { PrismaClient } from '@prisma/client';
import { Memory, MemoryProvider } from '../types';

interface CacheRecord {
  memory: Memory;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 5000;

export class CacheMemoryProvider implements MemoryProvider {
  name = 'cache';
  type = 'cache' as const;

  private readonly store = new Map<string, CacheRecord>();

  constructor(
    private prisma: PrismaClient,
    private logger: any,
    private maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  async cache(memory: Memory, ttl: number): Promise<void> {
    const expiresAt = Date.now() + ttl * 1000;

    // In-process hot path
    this.store.delete(memory.id);
    this.store.set(memory.id, { memory, expiresAt });
    this.evictIfNeeded();

    // Durable backup so a restart doesn't force a full cold cache
    try {
      const serialized = JSON.stringify(memory);
      await this.prisma.memoryCache.upsert({
        where: { memoryId: memory.id },
        create: {
          memoryId: memory.id,
          serialized,
          expiresAt: new Date(expiresAt),
        },
        update: {
          serialized,
          expiresAt: new Date(expiresAt),
          cachedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn('Failed to persist memory cache backup', { memoryId: memory.id, error });
    }
  }

  async getFromCache(memoryId: string): Promise<Memory | null> {
    const hit = this.store.get(memoryId);
    if (hit) {
      if (Date.now() > hit.expiresAt) {
        this.store.delete(memoryId);
      } else {
        // Refresh insertion order (LRU-by-insertion-order)
        this.store.delete(memoryId);
        this.store.set(memoryId, hit);
        this.recordHit(memoryId);
        return hit.memory;
      }
    }

    // Fall back to durable backup (covers cold start / process restart)
    try {
      const row = await this.prisma.memoryCache.findUnique({ where: { memoryId } });
      if (!row || row.expiresAt.getTime() < Date.now()) return null;

      const memory: Memory = JSON.parse(row.serialized);
      this.store.set(memoryId, { memory, expiresAt: row.expiresAt.getTime() });
      this.recordHit(memoryId);
      return memory;
    } catch (error) {
      this.logger.warn('Failed to read memory cache backup', { memoryId, error });
      return null;
    }
  }

  async invalidate(memoryId: string): Promise<void> {
    this.store.delete(memoryId);
    try {
      await this.prisma.memoryCache.deleteMany({ where: { memoryId } });
    } catch (error) {
      this.logger.warn('Failed to invalidate memory cache backup', { memoryId, error });
    }
  }

  async clearExpired(): Promise<number> {
    const now = Date.now();
    let cleared = 0;
    for (const [id, record] of this.store.entries()) {
      if (record.expiresAt < now) {
        this.store.delete(id);
        cleared++;
      }
    }

    try {
      const result = await this.prisma.memoryCache.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      cleared += result.count;
    } catch (error) {
      this.logger.warn('Failed to clear expired memory cache rows', { error });
    }

    return cleared;
  }

  size(): number {
    return this.store.size;
  }

  private recordHit(memoryId: string): void {
    this.prisma.memoryCache
      .update({
        where: { memoryId },
        data: { hits: { increment: 1 }, lastHitAt: new Date() },
      })
      .catch(() => {
        // Best-effort; cache hit accounting must never block a read.
      });
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }
}
