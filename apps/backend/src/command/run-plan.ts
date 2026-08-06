/**
 * Running a plan: several actions, in order, with the truth recorded at
 * every step.
 *
 * WHAT THIS FILE DOES NOT DO: execute anything itself. Each step is run by
 * the SAME `executeCommand` an ordinary single command goes through — which
 * means every step independently re-derives its capability, re-checks the
 * caller's permission at the moment it runs, honours the approval gate, and
 * writes its own durable `CommandExecution` audit row. A plan orchestrates;
 * it never becomes a second way to make something happen, and it can never
 * grant a step something the step could not get on its own.
 *
 * THE DESIGN PRINCIPLE: STOP HONESTLY, DO NOT PUSH ON.
 *
 * When a step does not complete, execution stops. It does not skip ahead to
 * "independent" later steps, and it does not retry. Both are tempting and
 * both are wrong here:
 *
 *   - Continuing past a failure means a person who asked for four things
 *     gets an unpredictable subset, and has to reconstruct which. Stopping
 *     leaves a state that can be described in one sentence.
 *   - Retrying means repeating a side effect Synora cannot prove is safe to
 *     repeat. Nothing in this layer carries an idempotency key yet, so a
 *     retried step could create a second schedule, a second conversation, a
 *     second anything. Not retrying is the only defensible default until
 *     safe retry can be PROVEN per capability rather than assumed.
 *
 * Steps never reached are recorded as `skipped`, which is deliberately not
 * `failed`: nothing was attempted, so nothing broke, and calling it a
 * failure would send someone hunting for a bug that does not exist.
 */

import { prisma } from '@synora/database';
import { planCommand, type PlannedStep } from './plan';
import { executeCommand, type ExecutionContext } from './execute';

/**
 * How a whole plan ended. `partially-completed` is first-class and never
 * collapsed into either neighbour: "three of four steps ran" is the truth,
 * and both `completed` and `failed` are lies about it.
 */
export type PlanStatus =
  | 'completed'
  | 'waiting-approval'
  | 'needs-input'
  | 'partially-completed'
  | 'failed'
  | 'cannot-plan';

export interface PlanRunStep {
  index: number;
  text: string;
  capabilityId: string | null;
  /** Ten command states, plus `skipped` for a step never reached. */
  state: string;
  message: string;
  dependsOn: number[];
  /** The audit record for this step, when it ran. */
  executionId?: string;
}

export interface PlanRunResult {
  planId: string;
  status: PlanStatus;
  originalText: string;
  steps: PlanRunStep[];
  /** One sentence a person can act on. */
  summary: string;
  /** 1-based index execution stopped at, when it did not finish. */
  stoppedAtStep?: number;
  stoppedReason?: string;
  /** How many steps genuinely ran to completion. Never an estimate. */
  completedCount: number;
  /**
   * Whether asking again is safe.
   *
   * False whenever any step completed, because re-running the whole
   * sentence would repeat those steps' side effects — a second
   * conversation, a second schedule. Synora will not imply an action is
   * repeatable until it can prove it per capability.
   */
  safeToRetry: boolean;
}

function summarize(status: PlanStatus, steps: PlanRunStep[], completed: number): string {
  const total = steps.length;
  switch (status) {
    case 'completed':
      return `Done — all ${total} action${total === 1 ? '' : 's'} completed.`;
    case 'waiting-approval':
      return `${completed} of ${total} done. The next one needs your approval before it can run.`;
    case 'needs-input':
      return `${completed} of ${total} done. The next one needs one more detail from you.`;
    case 'failed':
      return `Nothing was done — the first action did not go through.`;
    case 'partially-completed':
      return `${completed} of ${total} done, then I stopped. Nothing after that was attempted.`;
    default:
      return 'That request did not resolve into a plan.';
  }
}

/** The plan-level status implied by the step that stopped execution. */
function statusForStop(stoppedState: string, completed: number): PlanStatus {
  if (stoppedState === 'waiting-approval') return 'waiting-approval';
  if (stoppedState === 'needs-input') return 'needs-input';
  // Nothing ran at all: the honest word is `failed`, not "partial".
  return completed === 0 ? 'failed' : 'partially-completed';
}

/**
 * Resolve a sentence into a plan, store it, and run its steps in order.
 *
 * Every outcome is persisted — refusals and stops included — so a plan
 * survives a restart and an operator can answer "what did this actually
 * do?" without reconstructing it from logs.
 */
export async function runPlan(
  commandText: string,
  context: ExecutionContext
): Promise<PlanRunResult> {
  const plan = planCommand(commandText, context.role);

  if (plan.status === 'cannot-plan') {
    // Deliberately NOT persisted: nothing was planned and nothing ran, so
    // there is no plan to survive a restart. A stored empty plan would be
    // a record of an event that did not happen.
    return {
      planId: '',
      status: 'cannot-plan',
      originalText: plan.originalText,
      steps: [],
      summary: plan.question,
      completedCount: 0,
      safeToRetry: true,
    };
  }

  const record = await prisma.commandPlan.create({
    data: {
      workspaceId: context.workspaceId,
      userId: context.userId,
      originalText: plan.originalText,
      status: 'executing',
      steps: {
        create: plan.steps.map((step: PlannedStep) => ({
          index: step.index,
          text: step.text,
          capabilityId: step.capabilityId,
          riskClass: step.riskClass,
          permitted: step.permitted,
          dependsOn: step.dependsOn,
          // Resolved-but-not-yet-run. The plan's own readiness answer is
          // recorded so a later reader sees what the server decided BEFORE
          // execution, not a state reverse-engineered afterwards.
          state: 'pending',
        })),
      },
    },
    include: { steps: true },
  });

  const results: PlanRunStep[] = [];
  const completedIndices = new Set<number>();
  let stoppedAt: PlannedStep | undefined;
  let stoppedState = '';
  let stoppedMessage = '';

  for (const step of plan.steps) {
    if (stoppedAt) {
      // Everything after the stop is untouched, and says so.
      results.push({
        index: step.index,
        text: step.text,
        capabilityId: step.capabilityId,
        state: 'skipped',
        message: `Not attempted — execution stopped at step ${stoppedAt.index}.`,
        dependsOn: step.dependsOn,
      });
      continue;
    }

    // A dependency that did not complete means this step's input does not
    // exist. Running it anyway would act on missing data.
    const missing = step.dependsOn.find((dependency) => !completedIndices.has(dependency));
    if (missing !== undefined) {
      stoppedAt = step;
      stoppedState = 'skipped';
      stoppedMessage = `This needed the result of step ${missing}, which did not complete.`;
      results.push({
        index: step.index,
        text: step.text,
        capabilityId: step.capabilityId,
        state: 'skipped',
        message: stoppedMessage,
        dependsOn: step.dependsOn,
      });
      continue;
    }

    // THE REAL EXECUTION PATH. Same function, same permission re-check, same
    // approval gate, same audit row as a single command — correlated to this
    // plan so a trail reads PLAN → STEP → APPROVAL → outcome.
    const outcome = await executeCommand(step.text, context, {
      planId: record.id,
      planStepIndex: step.index,
    });

    results.push({
      index: step.index,
      text: step.text,
      capabilityId: outcome.capabilityId,
      state: outcome.state,
      message: outcome.message,
      dependsOn: step.dependsOn,
      executionId: outcome.executionId,
    });

    if (outcome.state === 'completed') {
      completedIndices.add(step.index);
    } else {
      stoppedAt = step;
      stoppedState = outcome.state;
      stoppedMessage = outcome.message;
    }
  }

  const completedCount = completedIndices.size;
  const status: PlanStatus = stoppedAt
    ? statusForStop(stoppedState, completedCount)
    : 'completed';

  await prisma.$transaction([
    ...results.map((step) =>
      prisma.commandPlanStep.update({
        where: { planId_index: { planId: record.id, index: step.index } },
        data: {
          state: step.state,
          resultSummary: step.state === 'completed' ? step.message : null,
          failureReason: step.state === 'completed' ? null : step.message,
          executionId: step.executionId ?? null,
          completedAt: step.state === 'completed' ? new Date() : null,
        },
      })
    ),
    prisma.commandPlan.update({
      where: { id: record.id },
      data: {
        status,
        stoppedAtStep: stoppedAt?.index ?? null,
        stoppedReason: stoppedAt ? stoppedMessage : null,
        completedAt: status === 'completed' ? new Date() : null,
      },
    }),
  ]);

  return {
    planId: record.id,
    status,
    originalText: plan.originalText,
    steps: results,
    summary: summarize(status, results, completedCount),
    ...(stoppedAt ? { stoppedAtStep: stoppedAt.index, stoppedReason: stoppedMessage } : {}),
    completedCount,
    // Any completed step makes the whole sentence unsafe to repeat.
    safeToRetry: completedCount === 0,
  };
}

/**
 * Read one stored plan back, workspace-scoped.
 *
 * Workspace-scoped in the QUERY rather than checked afterwards: a filter
 * that runs after the row is fetched is one refactor away from being
 * dropped, and the failure mode is cross-workspace disclosure.
 */
export async function getPlan(planId: string, workspaceId: string) {
  const plan = await prisma.commandPlan.findFirst({
    where: { id: planId, workspaceId },
    include: { steps: { orderBy: { index: 'asc' } } },
  });
  if (!plan) return null;

  return {
    planId: plan.id,
    status: plan.status,
    originalText: plan.originalText,
    stoppedAtStep: plan.stoppedAtStep,
    stoppedReason: plan.stoppedReason,
    createdAt: plan.createdAt,
    completedAt: plan.completedAt,
    steps: plan.steps.map((step) => ({
      index: step.index,
      text: step.text,
      capabilityId: step.capabilityId,
      state: step.state,
      message: step.resultSummary ?? step.failureReason ?? '',
      dependsOn: step.dependsOn,
      executionId: step.executionId ?? undefined,
    })),
  };
}
