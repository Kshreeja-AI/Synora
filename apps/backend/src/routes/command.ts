import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createApiResponse } from '@synora/shared';
import { understandCommand } from '../command/understand';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { searchLimiter } from '../middleware/resourceRateLimit.js';

const router: Router = Router();

const understandRequestSchema = z.object({
  // Bounded here as well as inside the understander: an entry point should
  // not rely on a downstream module to protect it from a large body.
  command: z.string().max(2_000),
});

/**
 * POST /api/command/understand — "what do you think I'm asking for?"
 *
 * The first step of the Universal Command Layer: a person writes a sentence,
 * and Synora states what it believes was asked, which real capability would
 * serve it, and what it could not determine.
 *
 * IT NEVER EXECUTES. The response carries `executed: false` as an explicit
 * field precisely so no caller can read an interpretation as evidence that
 * something happened. Acting on an interpretation goes through the surfaces
 * that already exist — each with its own permission checks, previews and
 * approval gates — and this route deliberately does not shortcut any of them.
 *
 * Consequently this route grants no authority: understanding a sentence
 * about deleting a database is not permission to delete one, and a person
 * who cannot use a capability does not gain it by describing it here.
 *
 * Authenticated because the capability catalogue in the response describes
 * what this deployment can do, which is not information for anonymous
 * callers. Rate-limited with the search limiter: cheap per call, but it is a
 * public-facing text entry point and should not be a free amplifier.
 */
router.post(
  '/understand',
  authMiddleware,
  searchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { command } = understandRequestSchema.parse(req.body);
      return res.json(createApiResponse(understandCommand(command)));
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
