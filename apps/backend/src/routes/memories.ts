import { Router, Response, type Router as ExpressRouter } from 'express'
import type { AuthRequest } from '../middleware/auth'
import { authMiddleware } from '../middleware/auth'
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess'
import { memoryService } from '../services/memory.service'
import { memoryEmbeddingService } from '../services/memoryEmbedding.service'
import { memoryCacheService } from '../services/memoryCache.service'
import { memoryGdprService } from '../services/memoryGdpr.service'
import { memoryAnalyticsService } from '../services/memoryAnalytics.service'
import { ApiException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'

const router: ExpressRouter = Router()

/** Rejects unparseable dates instead of passing `Invalid Date` into a query. */
function parseDateParam(raw: unknown, name: string): Date | undefined {
  if (raw === undefined) return undefined
  const parsed = new Date(String(raw))
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationException(`${name} must be a valid ISO date`)
  }
  return parsed
}

/**
 * POST /api/workspaces/:workspaceId/memories/search/semantic
 * Semantic search using embeddings. Returns 503 when the deployment has
 * no embedding provider configured — callers must be able to tell
 * "unavailable" from "no matches" and fall back to the lexical search
 * on `GET /memories?search=` instead.
 * IMPORTANT: Must be defined BEFORE routes with dynamic :memoryId parameter
 */
router.post('/:workspaceId/memories/search/semantic', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const { query, limit = 10 } = req.body

    if (!query) {
      throw new ValidationException('Query is required')
    }

    const results = await memoryEmbeddingService.semanticSearch(query, workspaceId, parseInt(limit))

    res.json({ success: true, data: results })
  } catch (error) {
    if (error instanceof ApiException) {
      res.status(error.statusCode).json({ error: error.message })
      return
    }
    logger.error('Semantic search failed', { error })
    res.status(500).json({ error: 'Search failed' })
  }
})

/**
 * POST /api/workspaces/:workspaceId/memories
 * Create a new memory
 */
router.post('/:workspaceId/memories', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const { conversationId, content, type, category, tags, permission, sharedWith, isManual } = req.body
    const userId = req.user!.id

    if (!content || !type) {
      throw new ValidationException('Content and type are required')
    }

    const memory = await memoryService.createMemory({
      workspaceId,
      conversationId,
      userId,
      content,
      type,
      category,
      tags,
      isManual,
      permission,
      sharedWith,
    })

    // Index embedding in background (fire and forget)
    memoryEmbeddingService.indexMemory(memory).catch((error) => {
      logger.error('Failed to index memory embedding', { error, memoryId: memory.id })
    })

    // Cache the memory
    await memoryCacheService.cacheMemory(memory)

    res.status(201).json({ success: true, data: memory })
  } catch (error) {
    logger.error('Failed to create memory', { error })
    if (error instanceof ValidationException) {
      return res.status(400).json({ error: error.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/workspaces/:workspaceId/memories/:memoryId/consolidate
 * Consolidate memories (summarization)
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.post('/:workspaceId/memories/:memoryId/consolidate', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const { memoryIds } = req.body

    if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
      throw new ValidationException('Memory IDs array is required')
    }

    const consolidated = await memoryService.consolidateMemories(memoryIds)

    // Invalidate workspace cache
    await memoryCacheService.invalidateWorkspace(workspaceId)

    res.json({ success: true, data: consolidated })
  } catch (error) {
    logger.error('Memory consolidation failed', { error })
    res.status(500).json({ error: 'Consolidation failed' })
  }
})

/**
 * POST /api/workspaces/:workspaceId/memories/:memoryId/pin
 * Pin a memory
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.post('/:workspaceId/memories/:memoryId/pin', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, memoryId } = req.params
    const userId = req.user!.id

    const updated = await memoryService.updateMemory(memoryId, { isPinned: true }, userId, workspaceId)

    await memoryCacheService.invalidateMemory(memoryId)
    await memoryCacheService.invalidateWorkspace(workspaceId)

    res.json({ success: true, data: updated })
  } catch (error) {
    logger.error('Failed to pin memory', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/workspaces/:workspaceId/memories/:memoryId/unpin
 * Unpin a memory
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.post('/:workspaceId/memories/:memoryId/unpin', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, memoryId } = req.params
    const userId = req.user!.id

    const updated = await memoryService.updateMemory(memoryId, { isPinned: false }, userId, workspaceId)

    await memoryCacheService.invalidateMemory(memoryId)
    await memoryCacheService.invalidateWorkspace(workspaceId)

    res.json({ success: true, data: updated })
  } catch (error) {
    logger.error('Failed to unpin memory', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/workspaces/:workspaceId/memories/:memoryId/resolve-conflict
 * Pick which version wins after a version conflict (e.g. concurrent edits)
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.post('/:workspaceId/memories/:memoryId/resolve-conflict', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, memoryId } = req.params
    const { selectedVersion } = req.body
    const userId = req.user!.id

    if (selectedVersion !== 'current' && selectedVersion !== 'previous') {
      throw new ValidationException('selectedVersion must be "current" or "previous"')
    }

    const resolved = await memoryService.resolveConflict(memoryId, selectedVersion, userId, workspaceId)

    await memoryCacheService.invalidateMemory(memoryId)
    await memoryCacheService.invalidateWorkspace(workspaceId)

    res.json({ success: true, data: resolved })
  } catch (error) {
    if (error instanceof ApiException) {
      res.status(error.statusCode).json({ error: error.message })
      return
    }
    logger.error('Failed to resolve memory conflict', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/stats
 * Get workspace memory statistics
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.get('/:workspaceId/memories/stats', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params

    // Check cache
    let stats = await memoryCacheService.getCachedWorkspaceStats(workspaceId)

    if (!stats) {
      stats = await memoryService.getWorkspaceStats(workspaceId)
      await memoryCacheService.cacheWorkspaceStats(workspaceId, stats)
    }

    res.json({ success: true, data: stats })
  } catch (error) {
    logger.error('Failed to get statistics', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/analytics
 * Full analytics report: creation/retrieval rates, importance distribution,
 * category and permission breakdowns, embedding coverage, decay.
 * `/memories/stats` returns only the five headline counters; this is the
 * detailed view behind them.
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.get('/:workspaceId/memories/analytics', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const from = parseDateParam(req.query.from, 'from')
    const to = parseDateParam(req.query.to, 'to')

    const analytics = await memoryAnalyticsService.getWorkspaceAnalytics(workspaceId, from, to)
    res.json({ success: true, data: analytics })
  } catch (error) {
    if (error instanceof ValidationException) {
      return res.status(400).json({ error: error.message })
    }
    logger.error('Failed to get memory analytics', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/analytics/trends?days=30
 * Day-bucketed creation, access and importance trends.
 */
router.get('/:workspaceId/memories/analytics/trends', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const raw = req.query.days
    let days = 30
    if (raw !== undefined) {
      days = Number(raw)
      // Unbounded windows scan the whole memory table; cap at a year.
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'days must be an integer between 1 and 365' })
      }
    }

    const trends = await memoryAnalyticsService.getTrendAnalysis(workspaceId, days)
    res.json({ success: true, data: trends })
  } catch (error) {
    logger.error('Failed to get memory trends', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/analytics/me
 * The caller's own slice of the workspace analytics. Scoped to req.userId
 * rather than an arbitrary id so it needs no extra authorization beyond
 * workspace membership.
 */
router.get('/:workspaceId/memories/analytics/me', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const analytics = await memoryAnalyticsService.getUserAnalytics(workspaceId, req.userId!)
    res.json({ success: true, data: analytics })
  } catch (error) {
    logger.error('Failed to get user memory analytics', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/export
 * Export memories (GDPR data portability)
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.get('/:workspaceId/memories/export', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const { format = 'json', includeMetadata, includeAuditLog } = req.query
    const userId = req.user!.id

    const exported = await memoryGdprService.exportUserMemories(userId, workspaceId, {
      format: format as 'json' | 'markdown' | 'csv',
      includeMetadata: includeMetadata === 'true',
      includeAuditLog: includeAuditLog === 'true',
    })

    res.setHeader('Content-Type', `application/${exported.format === 'json' ? 'json' : 'text/plain'}`)
    res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`)
    res.send(exported.data)
  } catch (error) {
    logger.error('Export failed', { error })
    res.status(500).json({ error: 'Export failed' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/audit/:memoryId
 * Get audit trail for a memory
 * IMPORTANT: Must be defined BEFORE catch-all GET/:memoryId route
 */
router.get('/:workspaceId/memories/audit/:memoryId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { memoryId } = req.params
    const userId = req.user!.id

    const auditTrail = await memoryGdprService.getMemoryAuditTrail(memoryId, userId)

    res.json({ success: true, data: auditTrail })
  } catch (error) {
    logger.error('Failed to get audit trail', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories/:memoryId
 * Get a specific memory
 * IMPORTANT: Must be defined AFTER all routes with specific static sub-paths
 */
router.get('/:workspaceId/memories/:memoryId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, memoryId } = req.params
    const userId = req.user!.id

    // Check cache first
    let memory = await memoryCacheService.getCachedMemory(memoryId)

    if (!memory) {
      memory = await memoryService.getMemory(memoryId, userId, workspaceId)
      await memoryCacheService.cacheMemory(memory)
    }

    res.json({ success: true, data: memory })
  } catch (error) {
    logger.error('Failed to get memory', { error })
    res.status(404).json({ error: 'Memory not found' })
  }
})

/**
 * GET /api/workspaces/:workspaceId/memories
 * Search memories
 * IMPORTANT: Must be defined AFTER all routes with dynamic :memoryId parameter
 */
router.get('/:workspaceId/memories', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const { conversationId, type, status, tags, search, limit = 20, offset = 0, pinnedOnly, archivedOnly } = req.query
    const userId = req.user!.id

    // Check cache for search results
    const cacheKey = `${workspaceId}:${search || ''}`
    const cached = await memoryCacheService.getCachedSearchResults(workspaceId, cacheKey)

    if (cached) {
      return res.json({ success: true, data: cached })
    }

    const result = await memoryService.searchMemories(
      {
        workspaceId,
        conversationId: conversationId as string,
        type: type as any,
        status: status as any,
        tags: tags ? (Array.isArray(tags) ? (tags as string[]) : [tags as string]) : [],
        searchTerm: search as string,
        limit: parseInt(limit as string) || 20,
        offset: parseInt(offset as string) || 0,
        pinnedOnly: pinnedOnly === 'true',
        archivedOnly: archivedOnly === 'true',
      },
      userId,
    )

    // Cache results
    await memoryCacheService.cacheSearchResults(workspaceId, cacheKey, result)

    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('Failed to search memories', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * PATCH /api/workspaces/:workspaceId/memories/:memoryId
 * Update a memory
 */
router.patch('/:workspaceId/memories/:memoryId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, memoryId } = req.params
    const userId = req.user!.id
    const { content, summary, category, tags, importance, isPinned, status } = req.body

    const updated = await memoryService.updateMemory(
      memoryId,
      { content, summary, category, tags, importance, isPinned, status },
      userId,
      workspaceId,
    )

    // Invalidate cache
    await memoryCacheService.invalidateMemory(memoryId)
    await memoryCacheService.invalidateWorkspace(workspaceId)

    // Queue embedding refresh if content changed
    if (content) {
      memoryEmbeddingService.regenerateEmbedding(memoryId).catch((error) => {
        logger.error('Failed to regenerate embedding', { error, memoryId })
      })
    }

    res.json({ success: true, data: updated })
  } catch (error) {
    logger.error('Failed to update memory', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * DELETE /api/workspaces/:workspaceId/memories/:memoryId
 * Delete (soft delete) a memory
 */
router.delete('/:workspaceId/memories/:memoryId', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, memoryId } = req.params
    const userId = req.user!.id

    await memoryService.deleteMemory(memoryId, userId, workspaceId)

    // Invalidate cache
    await memoryCacheService.invalidateMemory(memoryId)
    await memoryCacheService.invalidateWorkspace(workspaceId)

    res.json({ success: true, message: 'Memory deleted' })
  } catch (error) {
    logger.error('Failed to delete memory', { error })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * DELETE /api/workspaces/:workspaceId/memories/erase
 * GDPR data erasure
 * IMPORTANT: Must be defined AFTER catch-all DELETE/:memoryId route
 */
router.delete('/:workspaceId/memories/erase', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId } = req.params
    const userId = req.user!.id

    const result = await memoryGdprService.eraseUserData(userId, workspaceId)

    await memoryCacheService.invalidateWorkspace(workspaceId)

    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('Erasure failed', { error })
    res.status(500).json({ error: 'Erasure failed' })
  }
})

export default router
