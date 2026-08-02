import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireMembership } from '../services/checks'
import { createApiResponse } from '@synora/shared'
import { conversationUsageService } from '../services/conversationUsage.service'

const router: Router = Router({ mergeParams: true })

const DEFAULT_RANGE_DAYS = 30

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const ledgerSchema = rangeSchema.extend({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(20),
})

function resolveRange(input: { from?: string; to?: string }): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : new Date()
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
  return { from, to }
}

/**
 * GET /api/workspaces/:workspaceId/usage/summary?from=&to=
 * Aggregated token/cost usage for a workspace, defaulting to the
 * last 30 days.
 */
router.get('/:workspaceId/usage/summary', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    await requireMembership(req.userId!, workspaceId)

    const range = resolveRange(rangeSchema.parse(req.query))
    const summary = await conversationUsageService.getWorkspaceUsageSummary(workspaceId, range)

    res.json(createApiResponse(summary))
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/workspaces/:workspaceId/usage/ledger?skip=&take=&from=&to=
 * Paginated per-generation usage entries, newest first.
 */
router.get('/:workspaceId/usage/ledger', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    await requireMembership(req.userId!, workspaceId)

    const query = ledgerSchema.parse(req.query)
    const range = resolveRange(query)
    const ledger = await conversationUsageService.getWorkspaceUsageLedger(workspaceId, {
      skip: query.skip,
      take: query.take,
      from: range.from,
      to: range.to,
    })

    res.json(createApiResponse(ledger))
  } catch (error) {
    next(error)
  }
})

export default router
