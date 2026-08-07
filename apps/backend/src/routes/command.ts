import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createApiResponse, NotFoundException } from '@synora/shared';
import { understandCommand } from '../command/understand';
import { anyTextProviderConfigured } from '../command/availability';
import { prepareCommand } from '../command/prepare';
import { planCommand } from '../command/plan';
import { runPlan, getPlan } from '../command/run-plan';
import { executeCommand } from '../command/execute';
import { decideExecution, listExecutions, ApprovalRefused } from '../command/approve';
import { undoExecution, UndoRefused } from '../command/undo';
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
      return res.json(
        createApiResponse(
          understandCommand(command, { textProviderConfigured: await anyTextProviderConfigured() })
        )
      );
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
      return res.json(
        createApiResponse(
          prepareCommand(command, membership.role, {
            textProviderConfigured: await anyTextProviderConfigured(),
          })
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/command/:workspaceId/plan — "you asked for several things; here
 * they are, in order."
 *
 * People do not speak in single commands. This route splits one sentence
 * into the actions it describes and resolves EACH ONE independently — same
 * grammar, same catalogue, same permission model, same availability rules as
 * a single command, because a step is an ordinary command with an order
 * around it.
 *
 * NO STEP INHERITS ANYTHING FROM ITS NEIGHBOURS. Being allowed to find a
 * document says nothing about being allowed to send it to someone, and a
 * planner that decided entitlement once would let a harmless first step
 * carry a dangerous last one past the gate. Every step is asked every
 * question.
 *
 * Executes nothing — `executed: false` is a literal in the response type.
 * Running a plan (in order, pausing at each approval, with durable state) is
 * the next slice; a plan nobody can read is not something to start running.
 */
router.post(
  '/:workspaceId/plan',
  authMiddleware,
  searchLimiter,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { command } = understandRequestSchema.parse(req.body);
      const membership = await requireMembership(req.userId!, req.params.workspaceId);
      return res.json(
        createApiResponse(
          planCommand(command, membership.role, {
            textProviderConfigured: await anyTextProviderConfigured(),
          })
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/command/:workspaceId/plan/execute — run a multi-action request.
 *
 * Steps run IN ORDER, each through the same `executeCommand` a single
 * command uses: same permission re-check at the moment it runs, same
 * approval gate, same durable audit row — correlated to the plan so a trail
 * reads PLAN → STEP → APPROVAL → outcome.
 *
 * IT STOPS AT THE FIRST STEP THAT DOES NOT COMPLETE, and does not push on to
 * later steps even if they look independent. A person who asked for four
 * things and got an unpredictable subset has to reconstruct which; a plan
 * that stops leaves a state describable in one sentence. It also never
 * retries: no capability here carries an idempotency key yet, so a retry
 * could create a second schedule or a second conversation. `safeToRetry` in
 * the response says plainly whether asking again would repeat anything.
 */
router.post(
  '/:workspaceId/plan/execute',
  authMiddleware,
  searchLimiter,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { command } = understandRequestSchema.parse(req.body);
      const membership = await requireMembership(req.userId!, req.params.workspaceId);
      const outcome = await runPlan(command, {
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

/**
 * GET /api/command/:workspaceId/plans/:planId — what did that plan do?
 *
 * Load-bearing rather than convenience: a plan that stops at an approval is
 * answered later, possibly after a restart, and without this the stored
 * state would be a thing the system can reach and no person can read.
 * Workspace-scoped inside the query, so a plan id from another workspace is
 * simply not found.
 */
router.get(
  '/:workspaceId/plans/:planId',
  authMiddleware,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const plan = await getPlan(req.params.planId, req.params.workspaceId);
      if (!plan) {
        // 404, never 403 — the same rule every workspace-scoped route
        // follows, so an id from elsewhere reveals nothing by its status.
        // Thrown rather than hand-rolled so it takes the platform's shared
        // error shape, like every other not-found in this codebase.
        throw new NotFoundException('Plan');
      }
      return res.json(createApiResponse(plan));
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

/**
 * POST /api/command/:workspaceId/executions/:executionId/undo — reverse
 * something Synora did.
 *
 * The counterpart to the risk classification the whole layer already runs
 * on. `reversible` had been a claim the system made about actions without
 * being able to act on it; this is the action.
 *
 * NOTHING THE CALLER SENDS DECIDES WHAT IS REVERSED. There is no body. The
 * target was declared by the executor that performed the original work and
 * stored at that moment, so there is deliberately nothing here to tamper
 * with — the same shape as the decision route above, for the same reason.
 *
 * Permission is re-checked at undo time by the service that performs the
 * reversal, not inherited from the original action. Having been allowed to
 * create something is not standing permission to remove it later.
 */
router.post(
  '/:workspaceId/executions/:executionId/undo',
  authMiddleware,
  searchLimiter,
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await undoExecution(req.params.executionId, {
        userId: req.userId!,
        workspaceId: req.params.workspaceId,
      });
      return res.json(createApiResponse(result));
    } catch (error) {
      if (error instanceof UndoRefused) {
        // 200 with an explicit refusal, exactly as the decision route does.
        // The request was well-formed and correctly handled; the ANSWER is
        // "no, and here is why". An error status would make a legitimate
        // refusal look like a malfunction.
        return res.json(
          createApiResponse({
            executionId: req.params.executionId,
            undone: false,
            reason: error.reason,
            message: error.userMessage,
          })
        );
      }
      return next(error);
    }
  }
);

export default router;
