import { assertRunBudget } from './metering.js';
import { validatePlan, type RunEngineDeps } from './run-engine.js';
import { checkPlannedSteps, type PlannedStepCheck } from './step-checks.js';
import type { AgentPlan, ExecutableDefinition, PlannedStep } from './types.js';

/**
 * Agent plan preview: "plan first, run second."
 *
 * `startRun` plans and then immediately executes (pausing only where the
 * approval policy says so) — for an agent whose policy is `nothing`,
 * execution begins with no human ever seeing the plan. This module is
 * the missing first stage of the command pipeline: it produces the plan
 * through the SAME planner the real run would use, runs the SAME
 * validation and per-step preflight, and then STOPS. No run record is
 * created, no step executes, nothing enters the run list.
 *
 * TWO HONESTY POINTS THAT SHAPE THE REPORT:
 *
 * 1. A model-planned preview is NOT a promise. When the planner is a
 *    real model, starting the run plans AGAIN, and the second plan may
 *    differ from the one previewed. That is stated as a caveat rather
 *    than hidden, because a preview read as a guarantee is a lie with
 *    good intentions. The deterministic local planner produces the same
 *    plan every time, and the caveat says that too — which is exactly
 *    what the plan's `origin` label is for.
 *
 * 2. Producing the preview costs one planning call (a model call when a
 *    provider is configured; nothing meaningful locally). Stated, not
 *    hidden: "free preview" would be false in the one configuration
 *    where cost exists.
 *
 * BUDGET IS REPORTED, NOT ENFORCED — same rule as the workflow dry run:
 * someone out of credits needs this information most.
 */

export interface PlanPreviewReport {
  agentId: string;
  agentName: string;
  agentVersion: number;
  task: string;
  /** Literal: no run record exists and no step was executed. */
  executed: false;
  /** Where the plan came from — never collapsed into a generic label. */
  planOrigin: AgentPlan['origin'];
  /** False when something would stop the run before or during execution. */
  wouldStart: boolean;
  blockers: string[];
  steps: PlannedStepCheck[];
  projected: {
    steps: number;
    toolCalls: number;
    approvalPauses: number;
    maxSteps: number;
    maxToolCalls: number;
    maxDurationMs: number;
  };
  caveats: string[];
}

export async function previewAgentPlan(
  params: {
    agent: ExecutableDefinition;
    workspaceId: string;
    requestedBy: string;
    task: string;
  },
  deps: RunEngineDeps,
): Promise<PlanPreviewReport> {
  const { agent } = params;
  if (agent.archived) throw new Error('this agent is archived and cannot start new runs');
  if (params.task.trim().length === 0) throw new Error('a preview needs a task');

  const blockers: string[] = [];

  const plan = await deps.planner.plan({
    task: params.task,
    instructions: agent.instructions,
    allowedTools: agent.allowedTools,
  });

  const rejection = validatePlan(plan, agent);
  if (rejection) blockers.push(`the plan would be rejected: ${rejection}`);

  try {
    await assertRunBudget(params.workspaceId);
  } catch (err) {
    blockers.push(err instanceof Error ? err.message : String(err));
  }

  const steps = await checkPlannedSteps({
    steps: plan.steps,
    workspaceId: params.workspaceId,
    requestedBy: params.requestedBy,
    approvalPolicy: agent.approvalPolicy,
  });

  const toolCalls = plan.steps.filter((s: PlannedStep) => s.kind === 'tool').length;
  if (toolCalls > agent.limits.maxToolCalls) {
    blockers.push(
      `${toolCalls} tool step(s) exceed this agent's budget of ${agent.limits.maxToolCalls} tool call(s)`,
    );
  }

  const stepProblems = steps.filter((s) => s.problems.length > 0);
  if (stepProblems.length > 0) {
    blockers.push(
      `${stepProblems.length} step(s) would fail: ${stepProblems.map((s) => s.stepId).join(', ')}`,
    );
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: agent.version,
    task: params.task,
    executed: false,
    planOrigin: plan.origin,
    wouldStart: blockers.length === 0,
    blockers,
    steps,
    projected: {
      steps: plan.steps.length,
      toolCalls,
      approvalPauses: steps.filter((s) => s.pausesForApproval).length,
      maxSteps: agent.limits.maxSteps,
      maxToolCalls: agent.limits.maxToolCalls,
      maxDurationMs: agent.limits.maxDurationMs,
    },
    caveats: [
      'Nothing was executed: no step ran and no run record exists.',
      'Producing this preview consumed one planning call.',
      plan.origin === 'model'
        ? 'Starting the run plans AGAIN with the model, and the new plan may differ from this one — a model preview is a strong indication, not a promise.'
        : 'The local deterministic planner produces the same plan every time, so starting the run will follow exactly these steps (subject to run-time failures).',
      'A tool that passes every check here can still fail at run time (a remote error, a timeout, a rate limit hit by other traffic).',
    ],
  };
}
