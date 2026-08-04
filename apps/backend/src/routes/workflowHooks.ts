import { Router } from 'express';
import { z } from 'zod';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import { BudgetExceededError } from '../agents/metering';
import { persistTrigger, recordFired, resolveTriggerBySecret } from '../workflows/trigger';
import { startTriggeredWorkflowRun } from '../workflows/triggered-run';

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

    let run;
    try {
      // Shared with internal event triggers, so the two ways a workflow
      // starts without a person cannot drift apart on budget, authority or
      // billing.
      run = await startTriggeredWorkflowRun({
        workflowId: trigger.workflowId,
        workspaceId: trigger.workspaceId,
        requestedBy: trigger.createdBy,
        task: task || 'Triggered via webhook',
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) return next(new ValidationException(err.message));
      throw err;
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
