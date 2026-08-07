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
import { anyTextProviderConfigured } from './availability';
import { planCommand, type PlannedStep } from './plan';
import { executeCommand, type ExecutionContext } from './execute';
import { requireMembership } from '../services/checks';

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
  /** A person refused a step. Distinct from `failed`: nothing broke. */
  | 'rejected'
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
  const plan = planCommand(commandText, context.role, {
    textProviderConfigured: await anyTextProviderConfigured(),
  });

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

  const outcome = await executeSteps(record.id, plan.steps, {
    context,
    completedIndices: new Set<number>(),
    alreadyDone: [],
  });

  return { ...outcome, originalText: plan.originalText };
}

/** The minimum a step must carry to be executed — satisfied by a freshly
 *  planned step and by one loaded back from the database alike. */
interface RunnableStep {
  index: number;
  text: string;
  capabilityId: string | null;
  dependsOn: number[];
}

/**
 * The one place plan steps are executed, shared by a first run and by a
 * resume.
 *
 * Shared deliberately rather than written twice: two loops would eventually
 * disagree about when to stop, and the disagreement would surface as a
 * resumed plan quietly behaving differently from a fresh one — the hardest
 * class of bug to notice, because both paths look correct in isolation.
 */
async function executeSteps(
  planId: string,
  steps: RunnableStep[],
  options: {
    context: ExecutionContext;
    /** Indices already known to have completed (populated on resume). */
    completedIndices: Set<number>;
    /** Steps from an earlier pass, reported unchanged in the result. */
    alreadyDone: PlanRunStep[];
  }
): Promise<Omit<PlanRunResult, 'originalText'>> {
  const { context, completedIndices, alreadyDone } = options;
  const results: PlanRunStep[] = [];
  let stoppedAt: RunnableStep | undefined;
  let stoppedState = '';
  let stoppedMessage = '';

  for (const step of steps) {
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
    //
    // A later step needing approval pauses the plan AGAIN. An earlier
    // approval buys exactly the step it was given for: approving step 2 is
    // not consent to step 4, and treating it as such would be the
    // "approve once, act broadly" failure this layer exists to prevent.
    const outcome = await executeCommand(step.text, context, {
      planId,
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

  const allSteps = [...alreadyDone, ...results].sort((a, b) => a.index - b.index);
  const completedCount = completedIndices.size;
  const status: PlanStatus = stoppedAt
    ? statusForStop(stoppedState, completedCount)
    : 'completed';

  await prisma.$transaction([
    ...results.map((step) =>
      prisma.commandPlanStep.update({
        where: { planId_index: { planId, index: step.index } },
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
      where: { id: planId },
      data: {
        status,
        stoppedAtStep: stoppedAt?.index ?? null,
        stoppedReason: stoppedAt ? stoppedMessage : null,
        completedAt: status === 'completed' ? new Date() : null,
      },
    }),
  ]);

  return {
    planId,
    status,
    steps: allSteps,
    summary: summarize(status, allSteps, completedCount),
    ...(stoppedAt ? { stoppedAtStep: stoppedAt.index, stoppedReason: stoppedMessage } : {}),
    completedCount,
    // Any completed step makes the whole sentence unsafe to repeat.
    safeToRetry: completedCount === 0,
  };
}

/**
 * Continue a plan after the step it paused on was decided.
 *
 * Called by the approval path once a decision is durably recorded. It never
 * re-runs the decided step — that step already ran (or was refused) inside
 * the approval transaction, and repeating it would duplicate a side effect
 * a person explicitly authorised exactly once.
 *
 * WHAT AN APPROVAL DOES NOT BUY: anything beyond its own step. Every
 * remaining step is executed through the same `executeCommand`, so each
 * re-checks permission at the moment it runs and each stops for its own
 * approval if it needs one. Roles change while things sit in queues, and a
 * plan resumed tomorrow is not entitled to what its requester could do
 * yesterday.
 *
 * Returns null when the execution was not part of a plan — the ordinary
 * single-command case, which must be entirely unaffected by any of this.
 */
export async function resumePlanAfterStep(
  planId: string,
  decidedStepIndex: number,
  decided: { state: string; message: string; executionId: string }
): Promise<PlanRunResult | null> {
  const plan = await prisma.commandPlan.findUnique({
    where: { id: planId },
    include: { steps: { orderBy: { index: 'asc' } } },
  });
  if (!plan) return null;

  // Record the decided step's real outcome first, so the stored plan is
  // truthful even if resuming the remainder fails afterwards.
  await prisma.commandPlanStep.update({
    where: { planId_index: { planId, index: decidedStepIndex } },
    data: {
      state: decided.state,
      resultSummary: decided.state === 'completed' ? decided.message : null,
      failureReason: decided.state === 'completed' ? null : decided.message,
      executionId: decided.executionId,
      completedAt: decided.state === 'completed' ? new Date() : null,
    },
  });

  const completedIndices = new Set<number>(
    plan.steps.filter((s) => s.state === 'completed' || s.index === decidedStepIndex)
      .filter((s) => s.index !== decidedStepIndex || decided.state === 'completed')
      .map((s) => s.index)
  );

  const alreadyDone: PlanRunStep[] = plan.steps
    .filter((s) => s.index <= decidedStepIndex)
    .map((s) => ({
      index: s.index,
      text: s.text,
      capabilityId: s.capabilityId,
      state: s.index === decidedStepIndex ? decided.state : s.state,
      message:
        s.index === decidedStepIndex
          ? decided.message
          : (s.resultSummary ?? s.failureReason ?? ''),
      dependsOn: s.dependsOn,
      executionId: s.index === decidedStepIndex ? decided.executionId : (s.executionId ?? undefined),
    }));

  // The decided step did not complete — a rejection, or an approved action
  // that then failed. Nothing after it runs, and the plan says which.
  if (decided.state !== 'completed') {
    const status: PlanStatus = decided.state === 'rejected' ? 'rejected' : 'partially-completed';
    const remaining: PlanRunStep[] = plan.steps
      .filter((s) => s.index > decidedStepIndex)
      .map((s) => ({
        index: s.index,
        text: s.text,
        capabilityId: s.capabilityId,
        state: 'skipped',
        message: `Not attempted — execution stopped at step ${decidedStepIndex}.`,
        dependsOn: s.dependsOn,
      }));

    await prisma.$transaction([
      ...remaining.map((step) =>
        prisma.commandPlanStep.update({
          where: { planId_index: { planId, index: step.index } },
          data: { state: 'skipped', failureReason: step.message },
        })
      ),
      prisma.commandPlan.update({
        where: { id: planId },
        data: {
          status,
          stoppedAtStep: decidedStepIndex,
          stoppedReason: decided.message,
          completedAt: null,
        },
      }),
    ]);

    const steps = [...alreadyDone, ...remaining];
    const completedCount = completedIndices.size;
    return {
      planId,
      status,
      originalText: plan.originalText,
      steps,
      summary:
        status === 'rejected'
          ? `${completedCount} of ${steps.length} done. Step ${decidedStepIndex} was refused, so nothing after it was attempted.`
          : summarize(status, steps, completedCount),
      stoppedAtStep: decidedStepIndex,
      stoppedReason: decided.message,
      completedCount,
      safeToRetry: completedCount === 0,
    };
  }

  // Approved and completed: carry on with everything after it.
  const remaining: RunnableStep[] = plan.steps
    .filter((s) => s.index > decidedStepIndex)
    .map((s) => ({
      index: s.index,
      text: s.text,
      capabilityId: s.capabilityId,
      dependsOn: s.dependsOn,
    }));

  // The requester's CURRENT role, re-fetched — never a role remembered from
  // when the plan was created, and emphatically never a constant. Roles
  // change while plans sit in approval queues, and a plan resumed tomorrow
  // must be entitled to exactly what its requester can do TODAY.
  const requester = await requireMembership(plan.userId, plan.workspaceId).catch(() => null);
  if (!requester) {
    // The person who asked is no longer in this workspace. Their remaining
    // steps do not run under anyone else's authority.
    const stranded: PlanRunStep[] = remaining.map((s) => ({
      index: s.index,
      text: s.text,
      capabilityId: s.capabilityId,
      state: 'not-authorized',
      message:
        'The person who asked for this is no longer in this workspace, so the rest was not done.',
      dependsOn: s.dependsOn,
    }));
    await prisma.$transaction([
      ...stranded.map((step) =>
        prisma.commandPlanStep.update({
          where: { planId_index: { planId, index: step.index } },
          data: { state: 'not-authorized', failureReason: step.message },
        })
      ),
      prisma.commandPlan.update({
        where: { id: planId },
        data: {
          status: 'partially-completed',
          stoppedAtStep: decidedStepIndex + 1,
          stoppedReason: stranded[0]?.message ?? null,
        },
      }),
    ]);
    const steps = [...alreadyDone, ...stranded];
    return {
      planId,
      status: 'partially-completed',
      originalText: plan.originalText,
      steps,
      summary: summarize('partially-completed', steps, completedIndices.size),
      completedCount: completedIndices.size,
      safeToRetry: completedIndices.size === 0,
    };
  }

  const outcome = await executeSteps(planId, remaining, {
    context: { userId: plan.userId, workspaceId: plan.workspaceId, role: requester.role },
    completedIndices,
    alreadyDone,
  });

  return { ...outcome, originalText: plan.originalText };
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
