/**
 * Memory System REST API Routes
 * POST/GET/PATCH/DELETE memories, search, consolidate, export, import
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { MemoryService } from '../memory/memory.service';
import { PostgresMemoryProvider } from '../memory/providers/postgres.provider';
import { CreateMemoryInput, UpdateMemoryInput, MemorySearchQuery } from '../memory/types';
import { requireAuth } from '../middleware/auth';

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

  /**
   * POST /api/workspaces/:workspaceId/memories
   * Create a new memory
   */
  router.post(
    '/:workspaceId/memories',
    requireAuth,
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
    requireAuth,
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
    requireAuth,
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
    requireAuth,
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
    requireAuth,
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
    requireAuth,
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
    requireAuth,
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
    requireAuth,
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
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId } = req.params;
        const userId = (req as any).user?.id;
        const { format = 'json', filter } = req.body;

        const exportJob = await prisma.memoryExport.create({
          data: {
            workspaceId,
            userId,
            format,
            status: 'PENDING',
            storageKey: `exports/${workspaceId}/${userId}/${Date.now()}.${format}`,
          },
        });

        // Queue async export job
        // await exportQueue.add('export_memories', { jobId: exportJob.id });

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
    requireAuth,
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

        // Queue async import job
        // await importQueue.add('import_memories', { jobId: importJob.id });

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
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { memoryId, workspaceId } = req.params;

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
    requireAuth,
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

  return router;
}
