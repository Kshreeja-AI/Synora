import { logger } from '../utils/logger.js';
import { BudgetExceededError } from '../agents/metering.js';
import {
  claimBurstSlot,
  persistEventTrigger,
  recordEventFired,
  triggersFor,
  type WorkflowEvent,
} from './event-trigger.js';

/**
 * Turning something that happened into workflow runs.
 *
 * EMITTING NEVER FAILS THE ACTION THAT CAUSED IT. Someone uploading a file
 * asked to upload a file. If an automation another member wired up is
 * broken, out of budget, or pointing at an archived workflow, that is not
 * the uploader's problem and must not become their error message. So the
 * emit returns immediately, the dispatch happens on the next tick, and
 * every failure is logged rather than raised.
 *
 * THE TASK LINE CARRIES IDENTIFIERS AND NAMES, NOT CONTENT. A run's task
 * string reaches a model. Putting a file's contents in it would send data
 * to a provider because somebody uploaded it, which nobody agreed to; the
 * workflow's own steps can fetch what they need through tools that were
 * granted deliberately.
 */

function describe(event: WorkflowEvent): string {
  switch (event.name) {
    case 'asset.uploaded':
      return `A file named "${event.subjectName}" was uploaded to this workspace (asset ${event.subjectId}).`;
    case 'project.created':
      return `A project named "${event.subjectName}" was created in this workspace (project ${event.subjectId}).`;
  }
}

/**
 * Runs the triggers matching an event. Exported separately from `emit` so
 * tests can await the dispatch instead of racing a timer — the scheduling
 * is what `emit` adds, and scheduling is not what needs asserting.
 */
export async function dispatchWorkflowEvent(event: WorkflowEvent): Promise<void> {
  const matching = triggersFor(event);
  if (matching.length === 0) return;

  // Imported here rather than at module scope: the emit sites are services
  // like asset upload, and pulling the whole workflow engine into their
  // import graph would couple an upload to code it never touches when no
  // trigger exists.
  const { startTriggeredWorkflowRun } = await import('./triggered-run.js');

  for (const trigger of matching) {
    if (!claimBurstSlot(trigger.id)) {
      logger.warn('[events] trigger suppressed by burst limit', {
        triggerId: trigger.id,
        event: event.name,
        workspaceId: event.workspaceId,
        suppressedCount: trigger.suppressedCount,
      });
      await persistEventTrigger(trigger.id).catch(() => undefined);
      continue;
    }

    try {
      const run = await startTriggeredWorkflowRun({
        workflowId: trigger.workflowId,
        workspaceId: trigger.workspaceId,
        // The trigger's creator, never the person who caused the event.
        requestedBy: trigger.createdBy,
        task: describe(event),
      });
      recordEventFired(trigger.id);
      await persistEventTrigger(trigger.id);
      logger.info('[events] trigger fired', {
        triggerId: trigger.id,
        event: event.name,
        runId: run.id,
        state: run.state,
      });
    } catch (error) {
      // Including a spent budget: an automation that cannot pay is a thing
      // to see in the log, not an exception thrown at whoever uploaded a
      // file.
      logger.error('[events] trigger failed to start a run', {
        triggerId: trigger.id,
        event: event.name,
        workspaceId: event.workspaceId,
        budget: error instanceof BudgetExceededError,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Announces that something happened. Returns immediately; callers are
 * ordinary product code and must not wait on, or be broken by, whatever
 * automation is listening.
 */
export function emitWorkflowEvent(event: WorkflowEvent): void {
  setImmediate(() => {
    void dispatchWorkflowEvent(event).catch((error) => {
      logger.error('[events] dispatch failed', {
        event: event.name,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
