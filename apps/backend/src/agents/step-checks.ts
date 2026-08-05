import { ToolType } from '@prisma/client';
import { stepNeedsApproval } from './run-engine.js';
import { toToolInput } from './tool-runner-adapter.js';
import { SUPPORTED_EXECUTION_TYPES, validateToolInput } from '../services/tool-engine.service.js';
import { toolService } from '../services/tool.service.js';
import type { PlannedStep } from './types.js';

/**
 * Per-step preflight: everything knowable about a planned step WITHOUT
 * executing it, plus an explicit account of what is not.
 *
 * ONE CHECKER, TWO PREVIEWS. Workflow dry runs and agent plan previews
 * answer the same question — "what would happen?" — so they must answer
 * it with the same code. A second copy of these checks would eventually
 * disagree with the first, and two previews that disagree teach people
 * to trust neither.
 */
export interface PlannedStepCheck {
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

/** `{{name}}` references, matching the engine's own substitution syntax. */
function referencesIn(input: string): string[] {
  return [...input.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
}

async function checkTool(
  step: PlannedStep,
  workspaceId: string,
  requestedBy: string,
  check: PlannedStepCheck,
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

/**
 * Runs the full preflight over a planned step sequence, in plan order —
 * the same order the engine executes, which is what makes the
 * unresolved-reference scan meaningful.
 */
export async function checkPlannedSteps(params: {
  steps: PlannedStep[];
  workspaceId: string;
  requestedBy: string;
  approvalPolicy: string;
}): Promise<PlannedStepCheck[]> {
  const seen: string[] = [];
  const checks: PlannedStepCheck[] = [];

  for (const step of params.steps) {
    const check: PlannedStepCheck = {
      stepId: step.id,
      kind: step.kind,
      description: step.description,
      ...(step.toolId ? { toolId: step.toolId } : {}),
      pausesForApproval: stepNeedsApproval(step, params.approvalPolicy),
      // Undeclared means mutating. The check states the resolved value
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
    checks.push(check);
  }

  return checks;
}
