/**
 * Memory System REST API Routes
 * POST/GET/PATCH/DELETE memories, search, consolidate, export, import,
 * plus subsystem and lifecycle endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { MemoryService } from '../memory/memory.service';
import { PostgresMemoryProvider } from '../memory/providers/postgres.provider';
import { MemorySubsystemsService } from '../memory/memory-subsystems.service';
import { MemoryLifecycleService } from '../memory/memory-lifecycle.service';
import { CreateMemoryInput, UpdateMemoryInput, MemorySearchQuery } from '../memory/types';
import { authMiddleware } from '../middleware/auth';

const router = Router();

export function createMemoryRoutes(prisma: PrismaClient, logger: any): Router {
  const storageProvider = new PostgresMemoryProvider(prisma, logger);
  const memoryService = new MemoryService(
    prisma,
    storageProvider,
    storageProvider,
    storageProvider,
    storageProvider,
    logger
  );
  const subsystems = new MemorySubsystemsService(prisma, memoryService, logger);
  const lifecycle = new MemoryLifecycleService(prisma, memoryService, logger);

  // ---------------------------------------------------------------------------
  // Existing routes
  // ---------------------------------------------------------------------------

  /**
   * POST /api/workspaces/:workspaceId/memories
   * Create a new memory
   */
  router.post(
    '/:workspaceId/memories',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const input: CreateMemoryInput = req.body;

        const memory = await memoryService.createMemory(input, userId, workspaceId);

        res.status(201).json({
          success: true,
          data: memory,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/:memoryId
   * Get a specific memory
   */
  router.get(
    '/:workspaceId/memories/:memoryId',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;

        const memory = await memoryService.getMemory(memoryId, userId, workspaceId);

        if (!memory) {
          return res.status(404).json({ error: 'Memory not found' });
        }

        res.json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * PATCH /api/workspaces/:workspaceId/memories/:memoryId
   * Update a memory
   */
  router.patch(
    '/:workspaceId/memories/:memoryId',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;
        const input: UpdateMemoryInput = req.body;

        const memory = await memoryService.updateMemory(memoryId, input, userId, workspaceId);

        res.json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * DELETE /api/workspaces/:workspaceId/memories/:memoryId
   * Delete a memory (soft delete)
   */
  router.delete(
    '/:workspaceId/memories/:memoryId',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;

        await memoryService.deleteMemory(memoryId, userId, workspaceId);

        res.json({ success: true, message: 'Memory deleted' });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories
   * Search memories (full-text)
   */
  router.get(
    '/:workspaceId/memories',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const {
          q,
          type,
          category,
          tags,
          minImportance,
          limit = 20,
          offset = 0,
        } = req.query;

        const query: MemorySearchQuery = {
          workspaceId,
          userId,
          query: q as string | undefined,
          type: type as any,
          category: category as string | undefined,
          tags: tags ? (typeof tags === 'string' ? [tags] : tags) : undefined,
          minImportance: minImportance ? parseFloat(minImportance as string) : undefined,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        };

        const results = await memoryService.search(query);

        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/search/semantic
   * Semantic search using embeddings
   */
  router.post(
    '/:workspaceId/memories/search/semantic',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const { query, limit = 10, threshold = 0.7 } = req.body;

        const results = await memoryService.semanticSearch({
          workspaceId,
          query,
          limit,
          threshold,
        });

        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/consolidate
   * Consolidate related memories
   */
  router.post(
    '/:workspaceId/memories/consolidate',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { memoryIds } = req.body;

        if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
          return res.status(400).json({ error: 'memoryIds must be a non-empty array' });
        }

        const result = await memoryService.consolidate(memoryIds, workspaceId, userId);

        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/analytics
   * Get memory analytics for workspace
   */
  router.get(
    '/:workspaceId/memories/analytics',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;

        const analytics = await memoryService.getAnalytics(workspaceId);

        res.json({ success: true, data: analytics });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/export
   * Export memories to file
   */
  router.post(
    '/:workspaceId/memories/export',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { format = 'json', _filter } = req.body;

        const exportJob = await prisma.memoryExport.create({
          data: {
            workspaceId,
            userId,
            format,
            status: 'PENDING',
            storageKey: `exports/${workspaceId}/${userId}/${Date.now()}.${format}`,
          },
        });

        res.status(202).json({ success: true, data: exportJob });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/import
   * Import memories from file
   */
  router.post(
    '/:workspaceId/memories/import',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { format, storageKey } = req.body;

        const importJob = await prisma.memoryExport.create({
          data: {
            workspaceId,
            userId,
            format,
            status: 'PENDING',
            storageKey,
          },
        });

        res.status(202).json({ success: true, data: importJob });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/:memoryId/pin
   * Pin a memory
   */
  router.post(
    '/:workspaceId/memories/:memoryId/pin',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { memoryId } = req.params;

        const memory = await prisma.memory.update({
          where: { id: memoryId },
          data: { isPinned: true },
          include: { metadata: true },
        });

        res.json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/:memoryId/unpin
   * Unpin a memory
   */
  router.post(
    '/:workspaceId/memories/:memoryId/unpin',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { memoryId } = req.params;

        const memory = await prisma.memory.update({
          where: { id: memoryId },
          data: { isPinned: false },
          include: { metadata: true },
        });

        res.json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // New subsystem routes
  // ---------------------------------------------------------------------------

  /**
   * POST /api/workspaces/:workspaceId/memories/short-term
   * Create a short-term memory with auto-expiry
   */
  router.post(
    '/:workspaceId/memories/short-term',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { content, ttlSeconds, tags, category, context, conversationId } = req.body;

        const memory = await subsystems.createShortTermMemory({
          content,
          ttlSeconds,
          tags,
          category,
          context,
          conversationId,
          userId,
          workspaceId,
        });

        res.status(201).json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/:memoryId/promote
   * Promote a short-term memory to long-term
   */
  router.post(
    '/:workspaceId/memories/:memoryId/promote',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;
        const { importance, category, tags } = req.body;

        const memory = await lifecycle.promoteToLongTerm(memoryId, {
          importance,
          category,
          tags,
          userId,
          workspaceId,
        });

        res.json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/extract-semantic
   * Extract semantic memories from content
   */
  router.post(
    '/:workspaceId/memories/extract-semantic',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { content, conversationId, context } = req.body;

        const memories = await subsystems.extractSemanticMemories({
          content,
          conversationId,
          context,
          userId,
          workspaceId,
        });

        res.status(201).json({ success: true, data: memories });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/episodic
   * Create an episodic memory
   */
  router.post(
    '/:workspaceId/memories/episodic',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { content, conversationId, context, tags, importance } = req.body;

        const memory = await subsystems.createEpisodicMemory({
          content,
          conversationId,
          context,
          tags,
          importance,
          userId,
          workspaceId,
        });

        res.status(201).json({ success: true, data: memory });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/workspace-context
   * Aggregate workspace context
   */
  router.get(
    '/:workspaceId/memories/workspace-context',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const { limit, types } = req.query;

        const context = await subsystems.getWorkspaceContext({
          workspaceId,
          limit: limit ? parseInt(limit as string) : undefined,
          types: types ? (typeof types === 'string' ? [types] : types) as string[] : undefined,
        });

        res.json({ success: true, data: context });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/conversation/:conversationId/context
   * Build conversation context from relevant memories
   */
  router.get(
    '/:workspaceId/memories/conversation/:conversationId/context',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, conversationId } = req.params;
        const userId = (req as any).user?.id;
        const { limit } = req.query;

        const context = await subsystems.getConversationContext({
          workspaceId,
          conversationId,
          userId,
          limit: limit ? parseInt(limit as string) : undefined,
        });

        res.json({ success: true, data: context });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/user/:userId
   * Get all memories for a specific user
   */
  router.get(
    '/:workspaceId/memories/user/:userId',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, userId } = req.params;
        const { type, limit = '50', offset = '0' } = req.query;

        const memories = await subsystems.getUserMemories({
          workspaceId,
          userId,
          type: type as string | undefined,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        });

        res.json({ success: true, data: memories });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/pinned
   * Get all pinned memories for the workspace
   */
  router.get(
    '/:workspaceId/memories/pinned',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;

        const memories = await subsystems.getPinnedMemories({
          workspaceId,
          userId,
        });

        res.json({ success: true, data: memories });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/:memoryId/score
   * Recalculate importance score for a memory
   */
  router.post(
    '/:workspaceId/memories/:memoryId/score',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;

        const scored = await lifecycle.recalculateImportance(memoryId, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: scored });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/:memoryId/compress
   * Compress a memory (reduce content while retaining key facts)
   */
  router.post(
    '/:workspaceId/memories/:memoryId/compress',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;

        const compressed = await lifecycle.compressMemory(memoryId, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: compressed });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/summarize
   * Summarize multiple memories into a digest
   */
  router.post(
    '/:workspaceId/memories/summarize',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { memoryIds } = req.body;

        if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
          return res.status(400).json({ error: 'memoryIds must be a non-empty array' });
        }

        const summary = await lifecycle.summarizeMemories(memoryIds, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: summary });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/smart-retrieve
   * Smart retrieval with combined ranking (recency, relevance, importance)
   */
  router.post(
    '/:workspaceId/memories/smart-retrieve',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { query, limit = 10, weights, filters } = req.body;

        const results = await subsystems.smartRetrieve({
          workspaceId,
          userId,
          query,
          limit,
          weights,
          filters,
        });

        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/:memoryId/conflicts
   * Detect conflicting memories
   */
  router.get(
    '/:workspaceId/memories/:memoryId/conflicts',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;

        const conflicts = await lifecycle.detectConflicts(memoryId, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: conflicts });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/merge
   * Merge multiple memories into one
   */
  router.post(
    '/:workspaceId/memories/merge',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { memoryIds, strategy } = req.body;

        if (!Array.isArray(memoryIds) || memoryIds.length < 2) {
          return res.status(400).json({ error: 'memoryIds must contain at least 2 IDs' });
        }

        const merged = await lifecycle.mergeMemories(memoryIds, {
          strategy,
          userId,
          workspaceId,
        });

        res.json({ success: true, data: merged });
      } catch (error) {
        next(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Batch operations
  // ---------------------------------------------------------------------------

  /**
   * POST /api/workspaces/:workspaceId/memories/batch/create
   * Batch create multiple memories
   */
  router.post(
    '/:workspaceId/memories/batch/create',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { memories } = req.body;

        if (!Array.isArray(memories) || memories.length === 0) {
          return res.status(400).json({ error: 'memories must be a non-empty array' });
        }

        const results = await lifecycle.batchCreate(memories, {
          userId,
          workspaceId,
        });

        res.status(201).json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/batch/update
   * Batch update multiple memories
   */
  router.post(
    '/:workspaceId/memories/batch/update',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { updates } = req.body;

        if (!Array.isArray(updates) || updates.length === 0) {
          return res.status(400).json({ error: 'updates must be a non-empty array' });
        }

        const results = await lifecycle.batchUpdate(updates, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/batch/delete
   * Batch delete multiple memories
   */
  router.post(
    '/:workspaceId/memories/batch/delete',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { memoryIds } = req.body;

        if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
          return res.status(400).json({ error: 'memoryIds must be a non-empty array' });
        }

        const results = await lifecycle.batchDelete(memoryIds, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GDPR & compliance
  // ---------------------------------------------------------------------------

  /**
   * DELETE /api/workspaces/:workspaceId/memories/gdpr-erase
   * GDPR full erasure -- permanently removes all memory data for a user
   */
  router.delete(
    '/:workspaceId/memories/gdpr-erase',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;

        const result = await lifecycle.gdprErase({
          userId,
          workspaceId,
        });

        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------

  /**
   * GET /api/workspaces/:workspaceId/memories/:memoryId/versions
   * Get version history for a memory
   */
  router.get(
    '/:workspaceId/memories/:memoryId/versions',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;

        const versions = await lifecycle.getVersionHistory(memoryId, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: versions });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/:memoryId/revert
   * Revert a memory to a previous version
   */
  router.post(
    '/:workspaceId/memories/:memoryId/revert',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, memoryId } = req.params;
        const userId = (req as any).user?.id;
        const { targetVersion } = req.body;

        const reverted = await lifecycle.revertToVersion(memoryId, targetVersion, {
          userId,
          workspaceId,
        });

        res.json({ success: true, data: reverted });
      } catch (error) {
        next(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Vector & maintenance operations
  // ---------------------------------------------------------------------------

  /**
   * POST /api/workspaces/:workspaceId/memories/sync-vectors
   * Synchronize memory embeddings / vectors
   */
  router.post(
    '/:workspaceId/memories/sync-vectors',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { force = false } = req.body;

        const result = await lifecycle.syncVectors({
          workspaceId,
          userId,
          force,
        });

        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/refresh-stale
   * Refresh stale memories (re-evaluate decay, expiry, relevance)
   */
  router.post(
    '/:workspaceId/memories/refresh-stale',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;

        const result = await lifecycle.refreshStale({
          workspaceId,
          userId,
        });

        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/workspaces/:workspaceId/memories/recover
   * Attempt failure recovery on inconsistent memory state
   */
  router.post(
    '/:workspaceId/memories/recover',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;

        const result = await lifecycle.recover({
          workspaceId,
          userId,
        });

        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Health & detailed analytics
  // ---------------------------------------------------------------------------

  /**
   * GET /api/workspaces/:workspaceId/memories/health
   * Health check for the memory subsystem
   */
  router.get(
    '/:workspaceId/memories/health',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;

        const health = await lifecycle.healthCheck({ workspaceId });

        res.json({ success: true, data: health });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/workspaces/:workspaceId/memories/analytics/detailed
   * Detailed analytics with breakdowns
   */
  router.get(
    '/:workspaceId/memories/analytics/detailed',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const { from, to } = req.query;

        const analytics = await subsystems.getDetailedAnalytics({
          workspaceId,
          dateRange: from && to
            ? { from: new Date(from as string), to: new Date(to as string) }
            : undefined,
        });

        res.json({ success: true, data: analytics });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
