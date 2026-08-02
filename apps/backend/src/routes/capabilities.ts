import { Router, type Router as ExpressRouter } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { getPlatformCapabilities } from '../services/capabilities.service';

const router: ExpressRouter = Router();

/**
 * GET /api/capabilities
 *
 * Which credential-dependent capabilities are live in this deployment, and
 * what the platform does while the rest are unconfigured. This is the
 * operator's confirmation step after adding credentials to an environment.
 *
 * Authenticated deliberately: the response names which vendors a
 * deployment uses, which is not something to hand to anonymous callers.
 * It never reads or returns a secret value — only each subsystem's own
 * boolean "am I configured" answer.
 */
router.get('/capabilities', authMiddleware, async (_req: AuthRequest, res, next) => {
  try {
    res.json(createApiResponse(await getPlatformCapabilities()));
  } catch (error) {
    next(error);
  }
});

export const capabilityRoutes = router;
