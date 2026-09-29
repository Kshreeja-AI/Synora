import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { createApiResponse } from '@synora/shared';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { getWorkspaceWhatsNew, listWorkspaceActivity } from '../services/activity.service';

/**
 * The workspace's recent history, as sentences.
 *
 * Distinct from `/api/admin/audit-logs` on purpose: that is the
 * governance surface, permission-gated and exhaustive. This is the
 * human one — work events only, readable by any member, because it can
 * tell you nothing you could not learn by browsing the lists yourself.
 */

const router: ExpressRouter = Router({ mergeParams: true });

router.use('/:workspaceId/activity', authMiddleware, requireWorkspaceAccess());
router.use('/:workspaceId/whats-new', authMiddleware, requireWorkspaceAccess());

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** ISO timestamp; entries strictly before it, for paging backwards. */
  before: z.coerce.date().optional(),
});

router.get('/:workspaceId/activity', async (req: AuthRequest, res, next) => {
  try {
    const { limit, before } = querySchema.parse(req.query);
    const entries = await listWorkspaceActivity(req.userId!, req.params.workspaceId, {
      limit,
      before,
    });
    res.json(createApiResponse(entries));
  } catch (error) {
    next(error);
  }
});

/**
 * Reading this endpoint IS the visit — it returns what happened since
 * this person last asked, then moves their baseline forward. Null data
 * on a first-ever visit; a `count: 0` digest when nothing happened
 * since a real one.
 */
router.get('/:workspaceId/whats-new', async (req: AuthRequest, res, next) => {
  try {
    res.json(
      createApiResponse(await getWorkspaceWhatsNew(req.userId!, req.params.workspaceId)),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
