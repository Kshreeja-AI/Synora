import { assertRunBudget } from '../agents/metering.js';
import { validatePlan } from '../agents/run-engine.js';
import { checkPlannedSteps, type PlannedStepCheck } from '../agents/step-checks.js';
import { requireMembership } from '../services/checks.js';
import { requirePermission } from '../services/permissions.js';
import { getWorkflow } from './workflow-registry.js';

/**
 * Dry runs: everything the system can determine about a workflow WITHOUT
 * executing it, and an explicit account of what it cannot.
 *
 * WHY THIS IS NOT A SIMULATION. The tempting version of this feature
 * invents plausible outputs and shows a green run that never happened.
 * That is a demo, not a tool: the moment someone trusts it, it has lied.
 * So a dry run here executes nothing at all — no tool is called, no model
 * is asked, no run record is created — and reports only facts that are
 * knowable in advance. Every step also carries what remains UNKNOWN until
 * the real run, because a preview that hides its blind spots reads as a
 * guarantee.
 *
 * WHAT IT CHECKS is deliberately the set of failures that today only
 * surface mid-run, after earlier steps have already done real work:
 *
 * - the plan itself, through the same `validatePlan` the engine uses;
 * - each tool: does it exist in this workspace, is it active, does the
 *   platform actually support executing its type, does the step input
 *   satisfy the tool's required fields;
 * - tool-level approval, which fails an agent step by design (the engine
 *   never waits on a human timescale) — knowing that before you start is
 *   the difference between a planned pause and a surprise failure;
 * - the requester's own `tool:execute` permission, because an agent is
 *   never a way to do what its requester could not do themselves;
 * - `{{stepId}}` references that no earlier step provides, which would
 *   otherwise pass through into a prompt or tool payload verbatim;
 * - which steps will pause for approval, and the projected budget usage
 *   against the workflow's own limits.
 *
 * The per-step logic lives in `agents/step-checks.ts`, SHARED with the
 * agent plan preview — one checker, so the two previews can never
 * disagree with each other.
 *
 * BUDGET IS REPORTED, NOT ENFORCED. A dry run costs nothing, so refusing
 * it because the workspace is out of credits would withhold exactly the
 * information someone in that position needs. The exhausted budget shows
 * up as a blocker on the report instead.
 */

export type DryRunStepCheck = PlannedStepCheck;

export interface DryRunReport {
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  /** Literal, not inferred: no step of this workflow was executed. */
  executed: false;
  /** False when something would stop the run before or during execution. */
  wouldStart: boolean;
  /** Reasons the run would not start, or would fail once started. */
  blockers: string[];
  steps: DryRunStepCheck[];
  projected: {
    steps: number;
    toolCalls: number;
    approvalPauses: number;
    maxSteps: number;
    maxToolCalls: number;
    maxDurationMs: number;
  };
  /** The blind spots, stated rather than left to be assumed. */
  caveats: string[];
}

const CAVEATS = [
  'Nothing was executed: no tool ran, no model was called, and no run record exists.',
  'What a generate step will produce is unknowable in advance — only that it will run.',
  'A tool that passes every check here can still fail at run time (a remote error, a timeout, a rate limit hit by other traffic).',
  'Retries, cancellation and the wall-clock deadline depend on what happens during the run and are not projected.',
];

export async function dryRunWorkflow(params: {
  workflowId: string;
  workspaceId: string;
  requestedBy: string;
}): Promise<DryRunReport> {
  const workflow = getWorkflow(params.workflowId, params.workspaceId);
  if (!workflow) throw new Error('workflow not found');

  const blockers: string[] = [];
  if (workflow.archived) blockers.push('this workflow is archived and cannot start new runs');

  const rejection = validatePlan({ steps: workflow.steps, origin: 'authored' }, workflow);
  if (rejection) blockers.push(`the saved steps would be rejected: ${rejection}`);

  try {
    await assertRunBudget(params.workspaceId);
  } catch (err) {
    blockers.push(err instanceof Error ? err.message : String(err));
  }

  const toolSteps = workflow.steps.filter((s) => s.kind === 'tool');
  if (toolSteps.length > 0) {
    const membership = await requireMembership(params.requestedBy, params.workspaceId);
    try {
      requirePermission(membership.role, 'tool:execute');
    } catch {
      blockers.push(
        'you do not have permission to execute tools in this workspace, so every tool step would fail',
      );
    }
  }

  const steps = await checkPlannedSteps({
    steps: workflow.steps,
    workspaceId: params.workspaceId,
    requestedBy: params.requestedBy,
    approvalPolicy: workflow.approvalPolicy,
  });

  const projectedToolCalls = toolSteps.length;
  if (projectedToolCalls > workflow.limits.maxToolCalls) {
    blockers.push(
      `${projectedToolCalls} tool step(s) exceed this workflow's budget of ${workflow.limits.maxToolCalls} tool call(s)`,
    );
  }

  const stepProblems = steps.filter((s) => s.problems.length > 0);
  if (stepProblems.length > 0) {
    blockers.push(
      `${stepProblems.length} step(s) would fail: ${stepProblems.map((s) => s.stepId).join(', ')}`,
    );
  }

  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    executed: false,
    wouldStart: blockers.length === 0,
    blockers,
    steps,
    projected: {
      steps: workflow.steps.length,
      toolCalls: projectedToolCalls,
      approvalPauses: steps.filter((s) => s.pausesForApproval).length,
      maxSteps: workflow.limits.maxSteps,
      maxToolCalls: workflow.limits.maxToolCalls,
      maxDurationMs: workflow.limits.maxDurationMs,
    },
    caveats: CAVEATS,
  };
}
