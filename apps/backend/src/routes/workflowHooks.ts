import { Router } from 'express';
import { z } from 'zod';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import { assertRunBudget, BudgetExceededError, meterRun } from '../agents/metering';
import { persistRun } from '../agents/run-engine';
import { resolveAgentRuntime } from '../agents/runtime';
import { TERMINAL_RUN_STATES } from '../agents/types';
import { persistTrigger, recordFired, resolveTriggerBySecret } from '../workflows/trigger';
import { startWorkflowRun } from '../workflows/workflow-engine';

/**
 * Fires a workflow from OUTSIDE Synora — the event-triggered half of
 * automation the capability matrix names as missing next to schedules.
 *
 * NO SESSION, NO COOKIE, NO CSRF CHECK. That is deliberate, not an
 * oversight: this endpoint's caller is never a browser holding the
 * platform's own session, it is another system holding a secret. The path
 * segment IS the credential, exactly like `/api/shared/:shareToken` — the
 * same pattern already in production for shared conversations — except a
 * trigger's secret is hashed at rest like an API key rather than stored
 * plain, because a trigger can start real work against real tools and
 * real budget, the same risk class as an API key rather than a read-only
 * share link.
 *
 * A DISABLED OR NONEXISTENT TRIGGER GET THE SAME ANSWER. `resolveTrigger-
 * BySecret` already encodes that; this route does not add a second way to
 * distinguish them.
 *
 * AUTHORITY: the run executes as the trigger's CREATOR, never with
 * ambient permissions — the identical rule the scheduler uses for a clock-
 * started run, extended to an externally-started one. Their permissions,
 * their responsibility, their name in the run record.
 */

const router: Router = Router();

const fireSchema = z.object({ task: z.string().max(10_000).optional() });

router.post('/workflows/:secret', async (req, res, next) => {
  try {
    const trigger = resolveTriggerBySecret(req.params.secret);
    if (!trigger) return next(new NotFoundException('Trigger'));

    const { task } = fireSchema.parse(req.body ?? {});

    try {
      await assertRunBudget(trigger.workspaceId);
    } catch (err) {
      if (err instanceof BudgetExceededError) return next(new ValidationException(err.message));
      throw err;
    }

    const runtime = await resolveAgentRuntime(trigger.createdBy);
    const run = await startWorkflowRun(
      {
        workflowId: trigger.workflowId,
        workspaceId: trigger.workspaceId,
        requestedBy: trigger.createdBy,
        task: task || 'Triggered via webhook',
      },
      { toolRunner: runtime.deps.toolRunner, generate: runtime.deps.generate },
    );
    await persistRun(run.id);
    // A webhook-started run consumes the same resources as a manual one
    // and is billed identically — an external caller is not a discount.
    if (TERMINAL_RUN_STATES.includes(run.state)) {
      await meterRun({ run, capability: 'workflow-run' });
    }
    recordFired(trigger.id);
    await persistTrigger(trigger.id);

    res.status(201).json(
      createApiResponse({
        run,
        runtime: {
          mode: 'authored',
          notice:
            'AUTHORED: this run executed the steps written into the workflow, in order, with nothing improvised. It is repeatable by design.',
          planOrigin: run.plan?.origin,
        },
      }),
    );
  } catch (error) {
    // The workflow itself may have been archived, or its creator may have
    // lost access, since the trigger was made. Same vocabulary a manual
    // run already uses, so this endpoint does not grow a second one.
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'workflow not found') return next(new NotFoundException('Workflow'));
    if (message.includes('archived')) return next(new ValidationException(message));
    next(error);
  }
});

export default router;
