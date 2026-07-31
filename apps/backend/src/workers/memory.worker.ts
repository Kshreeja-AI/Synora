import { prisma as db } from '@synora/database'
import { memoryService } from '../services/memory.service'
import { memoryEmbeddingService } from '../services/memoryEmbedding.service'
import { memoryCacheService } from '../services/memoryCache.service'
import { MemoryStatus } from '@synora/database'
import { logger } from '../utils/logger'

/**
 * Background worker for memory system operations
 * Handles consolidation, decay scoring, cleanup, and batch processing
 */
export class MemoryWorker {
  /**
   * Consolidate and summarize memories daily
   */
  async consolidateMemories(workspaceId: string): Promise<{ consolidated: number; failed: number }> {
    try {
      logger.info(`Starting memory consolidation for workspace ${workspaceId}`)

      // Get quota
      const quota = await db.memoryQuota.findUnique({
        where: { workspaceId },
      })

      if (!quota) {
        return { consolidated: 0, failed: 0 }
      }

      // Check if we've hit daily limit
      if (quota.consolidationsUsedToday >= quota.maxConsolidationsPerDay) {
        logger.warn(`Consolidation limit reached for workspace ${workspaceId}`)
        return { consolidated: 0, failed: 0 }
      }

      // Find memories ready for consolidation
      const memories = await db.memory.findMany({
        where: {
          workspaceId,
          status: MemoryStatus.ACTIVE,
          importance: { lte: 0.3 },
          accessCount: { lt: 5 },
        },
        orderBy: { importance: 'asc' },
        take: 10,
      })

      let consolidated = 0
      let failed = 0

      for (const memory of memories) {
        try {
          // Summarize memory content (mock implementation)
          const summary = await this.summarizeContent(memory.content)

          // Update memory
          await db.memory.update({
            where: { id: memory.id },
            data: {
              summary,
              status: MemoryStatus.ACTIVE,
              updatedAt: new Date(),
            },
          })

          consolidated++

          // Update quota
          if (quota.consolidationsUsedToday < quota.maxConsolidationsPerDay) {
            await db.memoryQuota.update({
              where: { workspaceId },
              data: { consolidationsUsedToday: { increment: 1 } },
            })
          }
        } catch (error) {
          logger.error('Failed to consolidate memory', { error, memoryId: memory.id })
          failed++
        }
      }

      // Invalidate cache
      memoryCacheService.invalidateWorkspace(workspaceId)

      logger.info(`Consolidation complete: ${consolidated} succeeded, ${failed} failed`)
      return { consolidated, failed }
    } catch (error) {
      logger.error('Consolidation worker error', { error, workspaceId })
      return { consolidated: 0, failed: 0 }
    }
  }

  /**
   * Apply daily decay to memory importance
   */
  async applyMemoryDecay(workspaceId: string): Promise<{ processed: number; decayed: number }> {
    try {
      logger.info(`Starting memory decay for workspace ${workspaceId}`)

      const memories = await db.memory.findMany({
        where: {
          workspaceId,
          status: MemoryStatus.ACTIVE,
        },
      })

      let processed = 0
      let decayed = 0

      for (const memory of memories) {
        try {
          const updated = await memoryService.applyDecay(memory.id)

          if (updated.importance < memory.importance) {
            decayed++
          }

          processed++
        } catch (error) {
          logger.error('Failed to apply decay', { error, memoryId: memory.id })
        }
      }

      logger.info(`Decay complete: ${processed} processed, ${decayed} decayed`)
      return { processed, decayed }
    } catch (error) {
      logger.error('Decay worker error', { error, workspaceId })
      return { processed: 0, decayed: 0 }
    }
  }

  /**
   * Batch generate embeddings for memories
   */
  async generateEmbeddingsBatch(workspaceId: string, batchSize: number = 10): Promise<{ indexed: number; failed: number }> {
    try {
      logger.info(`Starting embedding generation for workspace ${workspaceId}`)

      // Find memories without embeddings
      const memories = await db.memory.findMany({
        where: {
          workspaceId,
          embeddingId: null,
        },
        take: batchSize,
      })

      if (memories.length === 0) {
        logger.debug(`No memories needing embeddings in ${workspaceId}`)
        return { indexed: 0, failed: 0 }
      }

      const result = await memoryEmbeddingService.batchIndexMemories(memories.map((m: typeof memories[0]) => m.id))

      logger.info(`Embedding generation complete: ${result.indexed} indexed, ${result.failed} failed`)
      return result
    } catch (error) {
      logger.error('Embedding generation worker error', { error, workspaceId })
      return { indexed: 0, failed: 0 }
    }
  }

  /**
   * Refresh stale embeddings
   */
  async refreshStaleEmbeddings(workspaceId: string, limit: number = 50): Promise<number> {
    try {
      logger.info(`Starting embedding refresh for workspace ${workspaceId}`)

      const refreshed = await memoryEmbeddingService.refreshPendingEmbeddings(workspaceId, limit)

      logger.info(`Embedding refresh complete: ${refreshed} refreshed`)
      return refreshed
    } catch (error) {
      logger.error('Embedding refresh worker error', { error, workspaceId })
      return 0
    }
  }

  /**
   * Clean up expired memories
   */
  async cleanupExpiredMemories(workspaceId: string): Promise<number> {
    try {
      logger.info(`Starting cleanup of expired memories in workspace ${workspaceId}`)

      // Find and delete soft-deleted memories older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const result = await db.memory.deleteMany({
        where: {
          workspaceId,
          status: MemoryStatus.DELETED,
          updatedAt: { lte: thirtyDaysAgo },
        },
      })

      logger.info(`Cleanup complete: ${result.count} memories deleted`)
      return result.count
    } catch (error) {
      logger.error('Cleanup worker error', { error, workspaceId })
      return 0
    }
  }

  /**
   * Update memory quota tracking (daily reset)
   */
  async updateMemoryQuotas(): Promise<number> {
    try {
      logger.info('Updating memory quotas')

      const updated = await db.memoryQuota.updateMany({
        data: {
          consolidationsUsedToday: 0,
          lastResetAt: new Date(),
        },
      })

      logger.info(`Quotas updated: ${updated.count} workspaces`)
      return updated.count
    } catch (error) {
      logger.error('Quota update worker error', { error })
      return 0
    }
  }

  /**
   * Recalculate memory importance scores
   */
  async recalculateImportanceScores(workspaceId: string): Promise<{ updated: number; failed: number }> {
    try {
      logger.info(`Recalculating importance scores for workspace ${workspaceId}`)

      const memories = await db.memory.findMany({
        where: { workspaceId },
      })

      let updated = 0
      let failed = 0

      for (const memory of memories) {
        try {
          const newImportance = memoryService.scoreMemoryImportance(memory)

          if (Math.abs(newImportance - memory.importance) > 0.01) {
            await db.memory.update({
              where: { id: memory.id },
              data: { importance: newImportance },
            })

            updated++
          }
        } catch (error) {
          logger.error('Failed to recalculate importance', { error, memoryId: memory.id })
          failed++
        }
      }

      logger.info(`Importance recalculation complete: ${updated} updated, ${failed} failed`)
      return { updated, failed }
    } catch (error) {
      logger.error('Importance recalculation error', { error, workspaceId })
      return { updated: 0, failed: 0 }
    }
  }

  /**
   * Archive old unused memories
   */
  async archiveUnusedMemories(workspaceId: string, daysThreshold: number = 30): Promise<number> {
    try {
      logger.info(`Archiving unused memories in workspace ${workspaceId}`)

      const threshold = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000)

      const result = await db.memory.updateMany({
        where: {
          workspaceId,
          isArchived: false,
          lastAccessedAt: { lte: threshold },
          importance: { lte: 0.2 },
        },
        data: {
          isArchived: true,
          updatedAt: new Date(),
        },
      })

      logger.info(`Archival complete: ${result.count} memories archived`)
      return result.count
    } catch (error) {
      logger.error('Archival worker error', { error, workspaceId })
      return 0
    }
  }

  /**
   * Private: Mock summarization
   */
  private async summarizeContent(content: string): Promise<string> {
    // Mock: return first 200 chars as summary
    return content.substring(0, 200) + (content.length > 200 ? '...' : '')
  }
}

export const memoryWorker = new MemoryWorker()
