import { startRun, type RunEngineDeps } from '../agents/run-engine.js';
import { getWorkflow } from './workflow-registry.js';
import type { AgentPlan, AgentPlanner, AgentRun } from '../agents/types.js';

/**
 * Running a workflow.
 *
 * This file is short on purpose, and the shortness is the design. There is
 * no workflow execution loop, because building a second one would mean two
 * implementations of retries, approval gates, tool budgets, deadlines and
 * cancellation — and the day they diverge, one of them is wrong in a way
 * nobody notices until an agent and a workflow behave differently on the
 * same tool. So a workflow run IS an engine run. It differs in exactly two
 * places: where the steps come from, and where the definition is resolved.
 */

/**
 * A "planner" that plans nothing. It returns the steps a person already
 * wrote, stamped `authored` so no surface can imply reasoning happened.
 *
 * The engine treats every planner as untrusted and re-validates its output
 * before executing — and that applies here too. The steps were validated
 * when the workflow was saved, but a definition loaded from disk is not
 * the same thing as one just written, so it is checked again.
 */
export function createAuthoredPlanner(steps: AgentPlan['steps']): AgentPlanner {
  return {
    async plan(): Promise<AgentPlan> {
      return { steps, origin: 'authored' };
    },
  };
}

/**
 * Starts a workflow run.
 *
 * The task is recorded but does NOT influence which steps run — a workflow
 * does the same thing every time, and that is the property people choose a
 * workflow for. The text is context: it flows into `generate` steps that
 * reference it, and it appears on the run record so the history answers
 * "what was this run for".
 */
export async function startWorkflowRun(
  params: {
    workflowId: string;
    workspaceId: string;
    requestedBy: string;
    task: string;
    /** Same-workspace project access is verified by the caller (route). */
    projectId?: string;
  },
  deps: Omit<RunEngineDeps, 'planner'>,
): Promise<AgentRun> {
  const workflow = getWorkflow(params.workflowId, params.workspaceId);
  // Cross-workspace and nonexistent are deliberately the same answer.
  if (!workflow) throw new Error('workflow not found');

  return startRun(
    {
      agentId: workflow.id,
      workspaceId: params.workspaceId,
      requestedBy: params.requestedBy,
      task: params.task,
      projectId: params.projectId,
    },
    {
      ...deps,
      planner: createAuthoredPlanner(workflow.steps),
      // The engine resolves definitions through this rather than the agent
      // registry, so workflows execute without the agent registry needing
      // to know workflows exist.
      resolveDefinition: getWorkflow,
    },
  );
}

/**
 * The deps a parked workflow run needs to resume. Approval and rejection go
 * through the engine's own `approveStep` / `rejectStep`; this only supplies
 * the resolver so the engine can find the workflow again.
 */
export function workflowRunDeps<T extends Omit<RunEngineDeps, 'planner'>>(
  deps: T,
  steps: AgentPlan['steps'] = [],
): RunEngineDeps {
  return { ...deps, planner: createAuthoredPlanner(steps), resolveDefinition: getWorkflow };
}
