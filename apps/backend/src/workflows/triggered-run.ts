import { assertRunBudget, meterRun } from '../agents/metering.js';
import { persistRun } from '../agents/run-engine.js';
import { resolveAgentRuntime } from '../agents/runtime.js';
import { TERMINAL_RUN_STATES, type AgentRun } from '../agents/types.js';
import { startWorkflowRun } from './workflow-engine.js';

/**
 * Starting a workflow because something happened, rather than because a
 * person pressed a button.
 *
 * THIS EXISTS SO THE TWO TRIGGER KINDS CANNOT DRIFT. A webhook fired from
 * outside and an internal event fired from inside must budget, execute,
 * bill and persist identically — a second copy of this sequence would
 * eventually disagree, and the disagreement would be about money and
 * authority, which are the worst two things to be quietly inconsistent
 * about.
 *
 * AUTHORITY IS ALWAYS THE TRIGGER'S CREATOR, never the person whose action
 * happened to emit the event. Someone uploading a file to a shared
 * workspace has not agreed to lend their permissions to whatever
 * automation another member wired up; the person who wired it up owns what
 * it does. This is the same rule the scheduler uses for a clock-started
 * run.
 *
 * BILLING IS IDENTICAL TO A MANUAL RUN. An automated caller is not a
 * discount, and a run nobody watched costs the same resources as one
 * somebody did.
 */
export async function startTriggeredWorkflowRun(input: {
  workflowId: string;
  workspaceId: string;
  /** The trigger's creator. Never the actor who caused the event. */
  requestedBy: string;
  task: string;
}): Promise<AgentRun> {
  // Throws BudgetExceededError, which callers translate into their own
  // vocabulary — an HTTP 400 for a webhook, a logged suppression for an
  // internal event.
  await assertRunBudget(input.workspaceId);

  const runtime = await resolveAgentRuntime(input.requestedBy);
  const run = await startWorkflowRun(
    {
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      requestedBy: input.requestedBy,
      task: input.task,
    },
    { toolRunner: runtime.deps.toolRunner, generate: runtime.deps.generate },
  );
  await persistRun(run.id);
  if (TERMINAL_RUN_STATES.includes(run.state)) {
    await meterRun({ run, capability: 'workflow-run' });
  }
  return run;
}
