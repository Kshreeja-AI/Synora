import { ToolType } from '@prisma/client';
import { assertRunBudget } from '../agents/metering.js';
import { stepNeedsApproval, validatePlan } from '../agents/run-engine.js';
import { toToolInput } from '../agents/tool-runner-adapter.js';
import { requireMembership } from '../services/checks.js';
import { requirePermission } from '../services/permissions.js';
import { SUPPORTED_EXECUTION_TYPES, validateToolInput } from '../services/tool-engine.service.js';
import { toolService } from '../services/tool.service.js';
import { getWorkflow } from './workflow-registry.js';
import type { PlannedStep } from '../agents/types.js';

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
 * BUDGET IS REPORTED, NOT ENFORCED. A dry run costs nothing, so refusing
 * it because the workspace is out of credits would withhold exactly the
 * information someone in that position needs. The exhausted budget shows
 * up as a blocker on the report instead.
 */

export interface DryRunStepCheck {
  stepId: string;
  kind: PlannedStep['kind'];
  description: string;
  toolId?: string;
  /** Resolved against the same predicate the engine uses at run time. */
  pausesForApproval: boolean;
  /** The declared value with the fail-closed default already applied. */
  treatedAsMutating: boolean;
  /** `{{refs}}` in the input that no earlier step supplies. */
  unresolvedReferences: string[];
  /** Conditions that would fail this step, found without executing it. */
  problems: string[];
  /** What cannot be known until the step actually runs. */
  unknowns: string[];
}

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

/** `{{name}}` references, matching the engine's own substitution syntax. */
function referencesIn(input: string): string[] {
  return [...input.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
}

async function checkTool(
  step: PlannedStep,
  workspaceId: string,
  requestedBy: string,
  check: DryRunStepCheck,
): Promise<void> {
  const toolId = step.toolId as string;
  let tool;
  try {
    tool = await toolService.getTool(requestedBy, workspaceId, toolId);
  } catch {
    // Cross-workspace and nonexistent are the same answer here as
    // everywhere else.
    check.problems.push(`tool "${toolId}" does not exist in this workspace`);
    return;
  }

  if (!tool.isActive) check.problems.push(`tool "${tool.displayName}" is not active`);

  if (!SUPPORTED_EXECUTION_TYPES.has(tool.type)) {
    check.problems.push(
      `${tool.type} tools cannot be executed yet (supported: ${[...SUPPORTED_EXECUTION_TYPES].join(', ')})`,
    );
  }

  try {
    validateToolInput(toToolInput(step.input), tool.inputSchema as Record<string, unknown>);
  } catch (err) {
    check.problems.push(
      `step input does not satisfy the tool's schema: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (tool.requiresApproval) {
    // Not a pause — a failure. The engine refuses to hold a run open for
    // a human timescale, so this step ends the run when it is reached.
    check.problems.push(
      `tool "${tool.displayName}" requires its own approval in the tools surface, which fails the step: ` +
        `a run cannot wait on a human there`,
    );
  }

  if (tool.type === ToolType.HTTP || tool.type === ToolType.Webhook) {
    check.unknowns.push('the remote endpoint is not contacted by a dry run');
  }
}

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

  const seen: string[] = [];
  const steps: DryRunStepCheck[] = [];

  for (const step of workflow.steps) {
    const check: DryRunStepCheck = {
      stepId: step.id,
      kind: step.kind,
      description: step.description,
      ...(step.toolId ? { toolId: step.toolId } : {}),
      pausesForApproval: stepNeedsApproval(step, workflow.approvalPolicy),
      // Undeclared means mutating. The dry run states the resolved value
      // so nobody has to know the default to read the report.
      treatedAsMutating: step.kind === 'tool' && step.mutating !== false,
      unresolvedReferences: referencesIn(step.input).filter((ref) => !seen.includes(ref)),
      problems: [],
      unknowns: [],
    };

    if (check.unresolvedReferences.length > 0) {
      check.problems.push(
        `references ${check.unresolvedReferences.map((r) => `{{${r}}}`).join(', ')}, which no earlier step produces — ` +
          `the text would be passed through literally`,
      );
    }

    if (step.kind === 'tool' && step.toolId) {
      await checkTool(step, params.workspaceId, params.requestedBy, check);
    } else if (step.kind === 'generate') {
      check.unknowns.push('the generated text is only knowable by running the step');
    }

    seen.push(step.id);
    steps.push(check);
  }

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
