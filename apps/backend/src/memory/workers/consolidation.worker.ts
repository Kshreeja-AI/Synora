/**
 * Memory Consolidation Worker
 * Periodically consolidates related memories to reduce storage and improve retrieval
 */

import { PrismaClient } from '@prisma/client';
import { MemoryService } from '../memory.service';
import { PostgresMemoryProvider } from '../providers/postgres.provider';

export async function consolidationWorker(
  prisma: PrismaClient,
  logger: any
) {
  const storageProvider = new PostgresMemoryProvider(prisma, logger);
  const memoryService = new MemoryService(
    prisma,
    storageProvider,
    storageProvider,
    storageProvider,
    storageProvider,
    logger
  );

  try {
    logger.info('Starting memory consolidation worker');

    // Get all workspaces
    const workspaces = await prisma.workspace.findMany();

    for (const workspace of workspaces) {
      try {
        // Get memories eligible for consolidation
        const memories = await prisma.memory.findMany({
          where: {
            workspaceId: workspace.id,
            status: 'ACTIVE',
            isArchived: false,
            importance: { lt: 0.7 }, // Low importance memories
            type: 'SEMANTIC',
            createdAt: {
              lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Older than 7 days
            },
          },
          take: 10, // Consolidate in batches
        });

        if (memories.length < 2) continue;

        // Find related memories
        const memoryIds = memories.map(m => m.id);

        // Group by category for consolidation
        const byCategory = memories.reduce(
          (acc, m) => {
            const cat = m.category || 'uncategorized';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(m.id);
            return acc;
          },
          {} as Record<string, string[]>
        );

        // Consolidate each category
        for (const [category, ids] of Object.entries(byCategory)) {
          if (ids.length < 2) continue;

          try {
            const result = await memoryService.consolidate(
              ids,
              workspace.id,
              memories[0].userId
            );

            logger.info('Memory consolidation completed', {
              workspaceId: workspace.id,
              category,
              memoryCount: ids.length,
              consolidatedId: result.consolidatedMemoryId,
              tokensReduced: result.tokensReduced,
            });
          } catch (error) {
            logger.error('Consolidation failed', { workspaceId: workspace.id, category, error });
          }
        }
      } catch (error) {
        logger.error('Error processing workspace consolidation', {
          workspaceId: workspace.id,
          error,
        });
      }
    }

    logger.info('Memory consolidation worker completed');
  } catch (error) {
    logger.error('Memory consolidation worker failed', { error });
  }
}

/**
 * Decay Worker
 * Applies memory decay based on access patterns
 */
export async function decayWorker(
  prisma: PrismaClient,
  logger: any
) {
  const storageProvider = new PostgresMemoryProvider(prisma, logger);
  const memoryService = new MemoryService(
    prisma,
    storageProvider,
    storageProvider,
    storageProvider,
    storageProvider,
    logger
  );

  try {
    logger.info('Starting memory decay worker');

    const workspaces = await prisma.workspace.findMany();

    for (const workspace of workspaces) {
      try {
        const decayedCount = await memoryService.applyDecay(workspace.id);

        if (decayedCount > 0) {
          logger.info('Memory decay applied', {
            workspaceId: workspace.id,
            decayedCount,
          });
        }
      } catch (error) {
        logger.error('Error applying decay', {
          workspaceId: workspace.id,
          error,
        });
      }
    }

    logger.info('Memory decay worker completed');
  } catch (error) {
    logger.error('Memory decay worker failed', { error });
  }
}

/**
 * Expiry Worker
 * Hard-deletes permanently deleted memories after retention period
 */
export async function expiryWorker(
  prisma: PrismaClient,
  logger: any,
  retentionDays = 30
) {
  try {
    logger.info('Starting memory expiry worker', { retentionDays });

    const expiryDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await prisma.memory.deleteMany({
      where: {
        status: 'DELETED',
        updatedAt: { lt: expiryDate },
      },
    });

    logger.info('Memory expiry worker completed', {
      deletedCount: result.count,
    });
  } catch (error) {
    logger.error('Memory expiry worker failed', { error });
  }
}

/**
 * Embedding Refresh Worker
 * Refreshes embeddings for memories that have been updated
 */
export async function embeddingRefreshWorker(
  prisma: PrismaClient,
  logger: any,
  embeddingService?: any
) {
  try {
    logger.info('Starting embedding refresh worker');

    const memories = await prisma.memory.findMany({
      where: {
        embeddingRefreshNeeded: true,
        status: 'ACTIVE',
      },
      take: 100, // Process in batches
    });

    let refreshedCount = 0;

    for (const memory of memories) {
      try {
        if (embeddingService?.embed) {
          const vector = await embeddingService.embed(memory.content, 'text-embedding-3-small');

          await prisma.memory.update({
            where: { id: memory.id },
            data: {
              embeddingId: `emb_${memory.id}`,
              embeddingModel: 'text-embedding-3-small',
              embeddingVersion: { increment: 1 },
              embeddingRefreshNeeded: false,
            },
          });

          refreshedCount++;
        }
      } catch (error) {
        logger.error('Failed to refresh embedding', { memoryId: memory.id, error });
      }
    }

    logger.info('Embedding refresh worker completed', { refreshedCount });
  } catch (error) {
    logger.error('Embedding refresh worker failed', { error });
  }
}
