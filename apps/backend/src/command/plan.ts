/**
 * A multi-action request, resolved into a plan a person can inspect before
 * anything happens.
 *
 * WHAT THIS FILE IS NOT: a second command layer. Every step is resolved by
 * the SAME `decideCommand` a single command goes through — same grammar,
 * same catalogue, same permission model, same availability rules, same ten
 * states. A plan is not a privileged path; it is several ordinary commands
 * with an order between them. Anything else would mean a person could get a
 * different answer for the same sentence by wrapping it in a plan, which is
 * precisely how a policy boundary gets bypassed.
 *
 * THE RULE THAT MATTERS MOST HERE: a step inherits NOTHING from its
 * neighbours. Not permission, not availability, not approval. "Find the
 * report" being allowed says nothing about whether the person may send it to
 * anyone, and a plan that decided entitlement once and reused it would let a
 * harmless first step carry a dangerous last one past the gate. Each step is
 * asked all the questions, every time.
 *
 * NOTHING HERE EXECUTES. This slice resolves and reports. `executed: false`
 * is a literal type, so no caller can read a plan as evidence something ran.
 * Orchestration — running steps in order, pausing at approvals, recording
 * durable state — is deliberately the next slice, because a plan nobody can
 * read is not something to start executing.
 */

import { decideCommand, isBound, messageFor, requiresApproval, type ExecutionState } from './execute';
import { decomposeCommand, MAX_PLAN_STEPS } from './decompose';
import type { CommandTextObservation } from './types';
import type { WorkspaceRole } from '../services/permissions';

export interface PlannedStep {
  /** 1-based, the order a person reads and the order execution would follow. */
  index: number;
  /** The person's own words for this step, verbatim. */
  text: string;
  /** What Synora believes this step is about. */
  understood: string;
  capabilityId: string | null;
  riskClass: string;
  requiredPermission: string | null;
  /** Whether THIS person's role permits THIS step. Never inherited. */
  permitted: boolean;
  /** Whether a person must approve before this step could run. */
  needsApproval: boolean;
  /** Whether the command layer can actually drive this capability today. */
  bound: boolean;
  /**
   * The same ten states a single command resolves to. `completed` here means
   * "decided to run" — nothing has, and `executed` on the plan says so.
   */
  readiness: ExecutionState;
  /** Plain language, for the person. Never a stack trace or a payload. */
  message: string;
  /** Steps whose output this one consumes. Empty when independent. */
  dependsOn: number[];
  /**
   * Set when a step Synora could otherwise run depends on a step that will
   * not produce output. Distinct from `readiness` on purpose: this step is
   * fine, its input is not, and telling someone their step is broken when
   * its prerequisite is the problem sends them to fix the wrong thing.
   */
  blockedBy?: number;
  /** Where the person can do this themselves, when Synora knows. */
  appPath?: string;
}

export type CommandPlan =
  | {
      status: 'planned';
      originalText: string;
      steps: PlannedStep[];
      /** One sentence a person can act on, e.g. what is ready and what is not. */
      summary: string;
      /**
       * Security observations across the WHOLE request and every segment.
       *
       * Aggregated deliberately: the specific danger of multi-step input is
       * a hostile phrase buried in step 4 of an otherwise ordinary-looking
       * request. An observation raised anywhere surfaces at the top.
       */
      observations: CommandTextObservation[];
      /** Literal false. A plan is a description; it is never evidence of action. */
      executed: false;
    }
  | {
      /** The request did not resolve into a plan. Never a partial guess. */
      status: 'cannot-plan';
      originalText: string;
      question: string;
      executed: false;
    };

/** Deduplicate observations by kind — the same warning twice is noise. */
function mergeObservations(all: CommandTextObservation[]): CommandTextObservation[] {
  const seen = new Set<string>();
  return all.filter((observation) => {
    if (seen.has(observation.kind)) return false;
    seen.add(observation.kind);
    return true;
  });
}

/**
 * The sentence a person reads for one step.
 *
 * The special case earns its place: a segment split out by the action-word
 * lexicon ("send the summary to the CFO") was recognized as a REQUEST for
 * something Synora has no capability for. The single-command grammar's
 * fallback — "I could not tell what you wanted me to do" — would blame the
 * person's phrasing for Synora's missing capability, and they would rewrite
 * a perfectly clear sentence forever. Naming the gap is the honest answer,
 * and it is the same distinction `not-bound` draws elsewhere in this layer.
 */
function stepMessage(
  decision: ReturnType<typeof decideCommand>,
  recognizedAs: 'grammar' | 'action-word'
): string {
  if (decision.state === 'completed') {
    return `Ready: ${decision.route?.summary ?? 'this can run.'}`;
  }
  if (decision.state === 'not-implemented' && recognizedAs === 'action-word') {
    return 'I understood that this is something you want done, but Synora has no way to do it yet. Nothing about this step will run.';
  }
  return messageFor(decision.state, decision.route, decision.detail);
}

function summarize(steps: PlannedStep[]): string {
  if (steps.length === 0) return 'There was nothing to do in that request.';

  const count = (state: PlannedStep['readiness']) =>
    steps.filter((step) => step.readiness === state).length;

  const ready = steps.filter((step) => step.readiness === 'completed' && !step.blockedBy).length;
  const blocked = steps.filter((step) => step.blockedBy !== undefined).length;
  // Counted separately, never summed into one "cannot" bucket. These are
  // four different problems with four different owners: an administrator
  // grants a permission, an operator adds a credential, an engineer builds
  // a capability, and nobody at all can fix a capability Synora lacks. A
  // person told the wrong one goes to the wrong place for help.
  const notAuthorized = count('not-authorized');
  const unavailable = count('unavailable');
  const notBound = count('not-bound');
  const notImplemented = count('not-implemented');
  const awaiting = count('waiting-approval');

  const parts: string[] = [
    `I read that as ${steps.length} action${steps.length === 1 ? '' : 's'}.`,
  ];
  if (ready > 0) parts.push(`${ready} ready to run.`);
  if (awaiting > 0) parts.push(`${awaiting} would need your approval first.`);
  if (notAuthorized > 0) parts.push(`${notAuthorized} you do not have permission for.`);
  if (unavailable > 0) parts.push(`${unavailable} needs a credential this deployment does not have.`);
  if (notBound > 0) parts.push(`${notBound} you would have to do in the app itself.`);
  if (notImplemented > 0) parts.push(`${notImplemented} Synora cannot do yet.`);
  if (blocked > 0) parts.push(`${blocked} depends on a step that will not run.`);
  return parts.join(' ');
}

/**
 * Resolve one multi-action request into an inspectable plan.
 *
 * Deterministic and local: no provider is contacted, and the same sentence
 * from the same role always produces the same plan. Never throws on hostile
 * input — a planner a sentence can crash is a denial-of-service surface.
 */
export function planCommand(
  commandText: string,
  role: WorkspaceRole,
  opts: { textProviderConfigured?: boolean } = {}
): CommandPlan {
  const textProviderConfigured = opts.textProviderConfigured ?? false;
  const originalText = typeof commandText === 'string' ? commandText : '';
  const decomposition = decomposeCommand(originalText);

  if (decomposition.status === 'too-many-steps') {
    return {
      status: 'cannot-plan',
      originalText,
      question: decomposition.question,
      executed: false,
    };
  }

  const observations: CommandTextObservation[] = [];
  const steps: PlannedStep[] = [];

  for (const segment of decomposition.steps) {
    // The SAME decision function a single command goes through. Every
    // question is asked again for this step: what capability, may this
    // person, is it available here, does it need approval, can we drive it.
    const decision = decideCommand(segment.text, role, { textProviderConfigured });
    observations.push(...decision.understanding.observations);

    steps.push({
      index: segment.index,
      text: segment.text,
      understood: decision.understanding.subject || decision.understanding.intent,
      capabilityId: decision.route?.capabilityId ?? null,
      riskClass: decision.route?.riskClass ?? 'read-only',
      requiredPermission: decision.route?.requiredPermission ?? null,
      permitted: decision.permitted,
      needsApproval: requiresApproval(decision.route),
      bound: isBound(decision.route?.capabilityId ?? null),
      readiness: decision.state,
      message: stepMessage(decision, segment.recognizedAs),
      dependsOn: segment.dependsOn,
      ...(decision.route?.appPath ? { appPath: decision.route.appPath } : {}),
    });
  }

  // A step is blocked when something it consumes will not produce output.
  // Computed after every step is resolved, in order, so a block propagates
  // down a chain: if step 2 cannot run, step 3 that depends on step 2 is
  // blocked too, even though step 3 itself is perfectly fine.
  const byIndex = new Map(steps.map((step) => [step.index, step]));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      const upstream = byIndex.get(dependency);
      if (!upstream) continue;
      const upstreamWillProduce = upstream.readiness === 'completed' && !upstream.blockedBy;
      if (!upstreamWillProduce) {
        step.blockedBy = dependency;
        step.message = `This needs the result of step ${dependency}, which is not going to run. ${step.message}`;
        break;
      }
    }
  }

  return {
    status: 'planned',
    originalText,
    steps,
    summary: summarize(steps),
    observations: mergeObservations(observations),
    executed: false,
  };
}

export { MAX_PLAN_STEPS };
