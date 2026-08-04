import { collectDue, persistSchedule } from './schedule.js';
import { startWorkflowRun } from './workflow-engine.js';
import { persistRun } from '../agents/run-engine.js';
import { meterRun } from '../agents/metering.js';
import { TERMINAL_RUN_STATES } from '../agents/types.js';
import { resolveAgentRuntime } from '../agents/runtime.js';
import { logger } from '../utils/logger.js';

/**
 * Turns due schedules into runs.
 *
 * WHOSE AUTHORITY A SCHEDULED RUN USES, which is the question that matters
 * most here. A run started by a clock has no requesting user, and the
 * tempting shortcut is to execute it with ambient or elevated authority
 * because "the system" started it. That would mean a schedule is a way to
 * run tools you are not allowed to run — a privilege escalation dressed as
 * a convenience.
 *
 * So a scheduled run executes as the person who created the schedule.
 * Their permissions, their responsibility, their name in the audit record.
 * If they lose access to a tool, their schedule stops being able to use
 * it, which is the correct consequence.
 *
 * FAILURES DO NOT STOP THE CLOCK. `collectDue` advances every schedule
 * before this function runs anything, so a workflow that throws on every
 * attempt cannot wedge the scheduler into retrying one occurrence forever.
 * The failure is logged and the next occurrence proceeds normally.
 */
export async function fireDueSchedules(now = Date.now()): Promise<number> {
  const due = collectDue(now);
  if (due.length === 0) return 0;

  let started = 0;
  for (const { schedule, missed } of due) {
    if (missed > 0) {
      // Surfaced at the moment it is discovered. Occurrences are never
      // replayed, so this log is the only place the gap appears until
      // someone reads the schedule record.
      logger.warn('Scheduled workflow occurrences were missed and will NOT be replayed.', {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        missed,
        totalMissed: schedule.missedOccurrences,
      });
    }

    try {
      const runtime = await resolveAgentRuntime(schedule.createdBy);
      const run = await startWorkflowRun(
        {
          workflowId: schedule.workflowId,
          workspaceId: schedule.workspaceId,
          requestedBy: schedule.createdBy,
          task: `Scheduled run (${schedule.kind})`,
        },
        { toolRunner: runtime.deps.toolRunner, generate: runtime.deps.generate },
      );
      await persistRun(run.id);
      // A scheduled run consumes the same resources as a manual one and
      // is billed identically — a clock is not a discount.
      if (TERMINAL_RUN_STATES.includes(run.state)) {
        await meterRun({ run, capability: 'workflow-run' });
      }
      started += 1;
    } catch (err) {
      // An archived or deleted workflow, or a workflow the creator can no
      // longer reach, lands here. Logged rather than thrown: one broken
      // schedule must not stop the others in this tick from firing.
      logger.error('A scheduled workflow run could not be started.', {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await persistSchedule(schedule.id);
  }
  return started;
}

let timer: NodeJS.Timeout | undefined;

/**
 * Starts the tick loop. The interval is the scheduler's resolution, not
 * its accuracy target: a schedule fires on the first tick at or after its
 * due time, so a 30s tick means up to 30s late. That is stated rather than
 * implied, because a user who reads "daily at 09:00" deserves to know it
 * means "at or shortly after".
 */
export function startWorkflowScheduler(tickMs = 30_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void fireDueSchedules().catch((err) => {
      logger.error('Workflow scheduler tick failed.', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, tickMs);
  // Does not hold the process open on its own.
  timer.unref?.();
  logger.info('Workflow scheduler started.', { tickMs });
}

export function stopWorkflowScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
