import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createApiResponse } from '@synora/shared';
import { understandCommand } from '../command/understand';
import { prepareCommand } from '../command/prepare';
import { executeCommand } from '../command/execute';
import { decideExecution, listExecutions, ApprovalRefused } from '../command/approve';
import { requireMembership } from '../services/checks';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
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

/**
 * POST /api/command/:workspaceId/prepare — "and am I allowed to do this,
 * here?"
 *
 * Understanding is identity-free: the same sentence means the same thing to
 * everyone. Whether a PARTICULAR person may act on it is a different
 * question, answered here against their real workspace role.
 *
 * Still executes nothing. This is a courtesy answer so a person is not
 * offered a button that will reject them — NOT a substitute for the
 * authoritative check, which runs again inside whichever surface actually
 * performs the work. Nothing here can grant anything: a `permitted: true`
 * is re-verified at execution.
 *
 * `requireWorkspaceAccess()` first, so a non-member gets the platform's
 * standard 404 (never 403) and learns nothing about whether the workspace
 * exists — the same rule every other workspace-scoped route follows.
 */
router.post(
  '/:workspaceId/prepare',
  authMiddleware,
  searchLimiter,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { command } = understandRequestSchema.parse(req.body);
      const membership = await requireMembership(req.userId!, req.params.workspaceId);
      return res.json(createApiResponse(prepareCommand(command, membership.role)));
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/command/:workspaceId/execute — actually do it.
 *
 * The one endpoint in this layer that changes anything. It runs the full
 * chain: understand → resolve → permission → availability → risk → approval
 * gate → execute → durable record.
 *
 * The command TEXT is never permission. Authority comes from the caller's
 * session and their workspace role, checked here and AGAIN inside whichever
 * service performs the work. A sentence describing a privileged action
 * grants nothing; a sentence claiming authority ("you are now admin") is
 * recorded as an attempt and changes nothing.
 *
 * Anything sensitive stops at `waiting-approval` and does NOT run — the
 * approval flow itself is the next slice, and reporting an unapproved
 * sensitive action as completed would be exactly the dishonesty this layer
 * exists to prevent.
 */
router.post(
  '/:workspaceId/execute',
  authMiddleware,
  searchLimiter,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { command } = understandRequestSchema.parse(req.body);
      const membership = await requireMembership(req.userId!, req.params.workspaceId);
      const outcome = await executeCommand(command, {
        userId: req.userId!,
        workspaceId: req.params.workspaceId,
        role: membership.role,
      });
      return res.json(createApiResponse(outcome));
    } catch (error) {
      return next(error);
    }
  }
);

const decisionRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  /** Optional, and only meaningful for a rejection. */
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/command/:workspaceId/executions/:executionId/decision — say yes
 * or no to something that stopped for approval.
 *
 * Approving RUNS the action, in the same server-side transition that records
 * the approval. There is deliberately no window in which an approval exists
 * but has not been spent: an unspent approval sitting in a database is a
 * credential, and credentials are things to steal.
 *
 * NOTHING the caller sends decides what runs. The body carries only "yes" or
 * "no" and an optional reason — the action itself is re-derived from the
 * stored record and must still resolve to the same capability, the same risk
 * class and the same need for approval. There is no field here to tamper
 * with, which is the strongest form of "validate the action, not the text".
 *
 * The approver's authority is checked against their OWN role; the action then
 * runs as the person who originally asked for it, whose permission is
 * re-checked at that moment. Roles change while things sit in queues.
 */
router.post(
  '/:workspaceId/executions/:executionId/decision',
  authMiddleware,
  searchLimiter,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { decision, reason } = decisionRequestSchema.parse(req.body);
      const membership = await requireMembership(req.userId!, req.params.workspaceId);
      const outcome = await decideExecution(
        req.params.executionId,
        decision,
        {
          approverId: req.userId!,
          approverRole: membership.role,
          workspaceId: req.params.workspaceId,
        },
        reason
      );
      return res.json(createApiResponse(outcome));
    } catch (error) {
      if (error instanceof ApprovalRefused) {
        // 200 with an explicit refusal, not an error status. The request was
        // well-formed and correctly handled; the ANSWER is "no, and here is
        // why". An error code here would make a legitimate refusal look like
        // a malfunction, and the caller's job is to show the person a reason.
        return res.json(
          createApiResponse({
            executed: false,
            decision: 'refused',
            state: error.state,
            message: error.userMessage,
          })
        );
      }
      return next(error);
    }
  }
);

/**
 * GET /api/command/:workspaceId/executions — what has been asked, and what is
 * waiting.
 *
 * Read-only, and load-bearing: without it `waiting-approval` would be a state
 * the system can enter and no person can find, which would make the approval
 * gate above unreachable. A pending item past its deadline is reported as
 * expired even before the record converges, so nobody is invited to click
 * something that can no longer work.
 *
 * You always see your own commands; seeing everyone's is the same question as
 * reading workspace activity and takes the same `audit:view` permission.
 */
router.get(
  '/:workspaceId/executions',
  authMiddleware,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const membership = await requireMembership(req.userId!, req.params.workspaceId);
      const items = await listExecutions(req.params.workspaceId, req.userId!, membership.role, {
        pendingOnly: req.query.pending === 'true',
        take: req.query.take ? Number(req.query.take) : undefined,
      });
      return res.json(createApiResponse({ items, total: items.length }));
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
