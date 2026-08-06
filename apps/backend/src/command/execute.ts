import { prisma } from '@synora/database';
import { prepareCommand, type PreparedCommand } from './prepare';
import { getTextProviderMetrics } from '../ai/textResilience';
import { searchService } from '../services/search.service';
import { conversationService } from '../services/conversation.service';
import { listWorkspaceActivity } from '../services/activity.service';
import { listRuns } from '../agents/run-engine';
import { listAgents } from '../agents/agent-registry';
import { previewAgentPlan } from '../agents/plan-preview';
import { resolveAgentRuntime } from '../agents/runtime';
import { resolveByName, nameSample, type NamedCandidate } from './resolve';
import { logger } from '../utils/logger';
import type { CommandRoute } from './types';
import type { WorkspaceRole } from '../services/permissions';

/**
 * Slice 3: actually doing the thing.
 *
 * Slices 1 and 2 understand a sentence and decide whether the person may act
 * on it. This one performs the action — by calling the SAME services the
 * existing routes call, never by re-implementing them and never by
 * simulating a result.
 *
 * THE HONESTY RULE THIS FILE EXISTS TO ENFORCE: seven outcomes, never
 * blurred into one another. A layer that reports "done" for a request it
 * merely understood is worse than one that cannot act at all, because the
 * person stops checking.
 *
 *   completed        the real capability ran and returned a real result
 *   not-authorized   understood, but this person may not do it
 *   unavailable      implemented, but this deployment lacks a credential
 *   not-implemented  Synora has no such capability at all
 *   not-bound        the capability EXISTS but the command layer cannot yet
 *                    drive it — a distinct state on purpose, because
 *                    reporting it as not-implemented would slander working
 *                    code, and reporting it as failed would blame the user
 *   waiting-approval a person must approve before anything happens
 *   failed           it ran and genuinely broke
 */

export type ExecutionState =
  | 'completed'
  | 'not-authorized'
  | 'unavailable'
  | 'not-implemented'
  | 'not-bound'
  | 'waiting-approval'
  | 'needs-input'
  | 'rejected'
  | 'expired'
  | 'failed';

/**
 * Raised by a bound executor when the sentence did not carry something the
 * capability genuinely needs — usually WHICH record the person meant.
 *
 * A tenth state instead of a stretch of an existing one, because every
 * neighbour would lie: `failed` blames a bug that does not exist,
 * `not-implemented` slanders working code, and `completed` with a question
 * inside would make `executed: true` mean "I asked you something". The
 * honest sentence is "Synora can do this and needs one more detail first",
 * and nothing ran.
 *
 * NEVER used to guess. When two records match, the question names them —
 * a wrong guess here is a confident action on a record nobody named, which
 * is the single worst thing this layer can do.
 */
export class NeedsInput extends Error {
  constructor(
    readonly question: string,
    readonly candidates: NamedCandidate[] = []
  ) {
    super(question);
    this.name = 'NeedsInput';
  }
}

/**
 * How long a pending approval stays answerable.
 *
 * Long enough that an approver in another timezone can sleep first; short
 * enough that nobody is ever asked to approve something whose context they
 * have forgotten. An approval is a judgement about a moment, and the moment
 * does not last forever — a request answered a week later is answered by
 * someone who no longer remembers why it was made.
 */
export const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which risk classes may run without a person approving first.
 *
 * Read-only and reversible actions proceed: stopping to ask about a search
 * teaches people to click through prompts without reading them, which is
 * how a warning that finally matters gets ignored. Anything that leaves
 * Synora, spends money, or changes who can do what stops and asks.
 */
const RUNS_WITHOUT_APPROVAL: ReadonlySet<CommandRoute['riskClass']> = new Set([
  'read-only',
  'reversible',
]);

export interface ExecutionContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

export interface CommandExecutionResult {
  executionId: string;
  state: ExecutionState;
  /** What Synora believed was asked, in the person's terms. */
  understood: string;
  capabilityId: string | null;
  riskClass: string;
  /** Plain-language outcome. Never a stack trace, never a raw payload. */
  message: string;
  /** The real result, when something actually ran. Absent otherwise. */
  result?: unknown;
  /** True only when a real capability was invoked. Never true for a refusal. */
  executed: boolean;
  /**
   * Where the person can do this themselves, when Synora knows. Present on
   * ANY outcome, not only refusals: a completed search is still worth being
   * able to open properly, and a capability that needs a credential is
   * still worth finding.
   */
  appPath?: string;
  /**
   * On `needs-input` only: the concrete choices behind the question, so a
   * UI can offer them rather than making the person retype a name.
   */
  candidates?: NamedCandidate[];
}

/**
 * The bound capabilities: capabilityId → a function that performs it by
 * calling the real service.
 *
 * Everything NOT in this map reports `not-bound` — honestly separating
 * "Synora cannot do this" from "the command layer cannot yet drive it".
 * Binding is deliberately incremental: each entry is a capability whose
 * real execution path has been read and whose result shape is understood.
 * A map entry that guessed at a service's contract would be exactly the
 * fabricated-adapter problem this codebase has been auditing all along.
 */
type BoundExecutor = (context: ExecutionContext, subject: string) => Promise<{
  result: unknown;
  summary: string;
}>;

const BOUND: Readonly<Record<string, BoundExecutor>> = {
  'search.workspace': async (context, subject) => {
    const found = await searchService.searchConversations({
      workspaceId: context.workspaceId,
      query: subject,
      userId: context.userId,
      take: 20,
    });
    return {
      result: found,
      summary: `Found ${found.total} result${found.total === 1 ? '' : 's'} for "${subject}".`,
    };
  },

  'providers.metrics': async () => {
    const providers = getTextProviderMetrics();
    const names = Object.keys(providers);
    return {
      result: { providers, scope: 'this process since it started; resets on restart' },
      summary:
        names.length === 0
          ? 'No AI provider calls have been made in this process yet.'
          : `Reported activity for ${names.length} provider${names.length === 1 ? '' : 's'}.`,
    };
  },

  'approvals.waiting': async (context) => {
    // The same in-memory run registry the runs list serves from, filtered
    // the same way the home page filters it. Deliberately NOT a new query
    // that could answer "what is waiting" differently from the panel a
    // person already trusts.
    const paused = listRuns(context.workspaceId).filter(
      (run) => run.state === 'awaiting_approval'
    );
    const commands = await prisma.commandExecution.count({
      where: {
        workspaceId: context.workspaceId,
        approvalState: 'pending',
        state: 'waiting-approval',
      },
    });
    const total = paused.length + commands;
    return {
      result: {
        pausedRuns: paused.map((run) => ({
          id: run.id,
          task: run.task,
          reason: run.pendingApproval?.reason ?? null,
          createdAt: run.createdAt,
        })),
        pendingCommands: commands,
        // Named explicitly so the count can never read as "everything".
        // Tool executions awaiting approval are a third queue this does
        // not yet read, and a total that quietly omitted them would be
        // worse than one that says what it covered.
        covers: 'agent runs and commands; not tool executions',
      },
      summary:
        total === 0
          ? 'Nothing is waiting for your decision in agent runs or commands.'
          : `${total} thing${total === 1 ? ' is' : 's are'} waiting for a decision.`,
    };
  },

  'activity.recent': async (context) => {
    // listWorkspaceActivity performs its own requireMembership, and shows
    // only the work-event allowlist — governance events stay behind
    // audit:view and are not reachable from here.
    const entries = await listWorkspaceActivity(context.userId, context.workspaceId, {
      limit: 20,
    });
    return {
      result: { entries },
      summary:
        entries.length === 0
          ? 'Nothing has been recorded in this workspace yet.'
          : `Here are the last ${entries.length} thing${entries.length === 1 ? '' : 's'} that happened.`,
    };
  },

  'agent.preview': async (context, subject) => {
    // First capability bound THROUGH resolution: the sentence names an
    // agent loosely; the preview needs a specific one. Resolution is
    // workspace-scoped by construction — the candidate list comes from
    // listAgents(workspaceId), so a sentence cannot name its way into
    // another workspace's agents.
    const agents = listAgents(context.workspaceId);
    if (agents.length === 0) {
      throw new NeedsInput(
        'This workspace has no agents yet, so there is nothing to preview. Create one on the Agents page first.'
      );
    }

    const resolution = resolveByName(agents, subject);
    if (resolution.status === 'unresolved') {
      throw resolution.matched.length > 0
        ? new NeedsInput(
            `Which agent did you mean — ${nameSample(resolution.matched)}?`,
            resolution.matched.map((a) => ({ id: a.id, name: a.name }))
          )
        : new NeedsInput(
            `I could not tell which agent you meant. This workspace has ${nameSample(agents)}.`,
            agents.map((a) => ({ id: a.id, name: a.name }))
          );
    }

    // The same preview the Agents page runs: same planner, same validation,
    // same per-step checks. Never a re-implementation.
    const runtime = await resolveAgentRuntime(context.userId);
    const report = await previewAgentPlan(
      {
        agent: resolution.entity,
        workspaceId: context.workspaceId,
        requestedBy: context.userId,
        task: subject,
      },
      runtime.deps
    );
    return {
      result: { ...report, runtime: { mode: runtime.mode, notice: runtime.notice } },
      summary: `Previewed what "${resolution.entity.name}" would do — ${report.steps.length} step${
        report.steps.length === 1 ? '' : 's'
      } planned, nothing run.`,
    };
  },

  'conversation.create': async (context, subject) => {
    // conversationService.create runs its OWN requireMembership +
    // requirePermission. That is the authoritative check re-running at the
    // moment of execution, exactly as it should — the command layer's
    // earlier answer was a courtesy, not a substitute.
    const conversation = await conversationService.create(context.userId, context.workspaceId, {
      title: subject.length > 0 ? subject.slice(0, 100) : 'Untitled Conversation',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    });
    return {
      result: { id: conversation.id, title: conversation.title },
      summary: `Created the conversation "${conversation.title}".`,
    };
  },
};

/** Human-language outcome for each non-completed state. */
export function messageFor(
  state: ExecutionState,
  route: CommandRoute | null,
  detail?: string
): string {
  switch (state) {
    case 'not-authorized':
      return `I understood what you asked, but you do not have permission to do this${
        route?.requiredPermission ? ` — it needs "${route.requiredPermission}"` : ''
      }.`;
    case 'unavailable':
      return "I can do this, but it is not connected in this deployment yet, so I have not tried.";
    case 'not-implemented':
      return detail ?? 'Synora cannot do this yet.';
    case 'not-bound':
      // Names the page when there is one. "Available in the app itself" is
      // true and useless — it leaves a person who asked for help holding a
      // refusal and no next step. Silent about the destination when the
      // catalogue has none, because a wrong page costs a click, a wait, and
      // the belief that Synora knows its own product.
      return route?.appPath
        ? `Synora can do this, but not yet by being asked in plain language. You can do it yourself on the ${route.appPath} page.`
        : 'Synora can do this, but not yet by being asked in plain language. It is available in the app itself.';
    case 'waiting-approval':
      return 'I can do this, and it needs your approval first because it changes something outside Synora or affects other people.';
    case 'needs-input':
      return detail ?? 'I can do this, and I need one more detail from you first. Nothing has run.';
    case 'rejected':
      return detail ?? 'This was refused, so nothing was done.';
    case 'expired':
      return 'Nobody answered this in time, so nothing was done. Ask again if you still want it.';
    case 'failed':
      return detail ?? 'I tried to do this and it did not work.';
    default:
      return 'Done.';
  }
}

/**
 * The decision, separated from the doing.
 *
 * Both the direct execute path and the approval path resolve what should
 * happen through THIS function, so the two can never disagree about what a
 * command means or who may run it. An approval path with its own copy of
 * this logic is how a system ends up approving one thing and performing
 * another.
 */
export interface CommandDecision {
  understanding: PreparedCommand['understanding'];
  route: CommandRoute | null;
  permitted: boolean;
  state: ExecutionState;
  detail?: string;
}

export function decideCommand(commandText: string, role: WorkspaceRole): CommandDecision {
  const prepared = prepareCommand(commandText, role);
  const { understanding } = prepared;
  const candidate = prepared.capabilities[0] ?? null;
  const route = candidate?.route ?? null;

  // Resolve the state BEFORE doing anything, so the decision to act is a
  // single explicit branch rather than something that emerges from control
  // flow — the security-relevant question is "did we decide to run this?",
  // and that must be answerable by reading one place.
  let state: ExecutionState;
  let detail: string | undefined;

  if (understanding.intent === 'not-yet-capable') {
    state = 'not-implemented';
    detail = understanding.unknowns[0];
  } else if (!route) {
    state = 'not-implemented';
    detail = 'I could not tell what you wanted me to do.';
  } else if (!candidate!.permitted) {
    state = 'not-authorized';
  } else if (route.availability !== 'available') {
    state = 'unavailable';
  } else if (!RUNS_WITHOUT_APPROVAL.has(route.riskClass)) {
    state = 'waiting-approval';
  } else if (!BOUND[route.capabilityId]) {
    state = 'not-bound';
  } else {
    state = 'completed';
  }

  return {
    understanding,
    route,
    permitted: candidate?.permitted ?? false,
    state,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Performs a resolved capability. The ONLY place a bound executor is called
 * — the approval path runs through here too, so an approved action and a
 * directly-executed one take literally the same code.
 */
export async function runBound(
  capabilityId: string,
  context: ExecutionContext,
  subject: string
): Promise<
  | { ok: true; result: unknown; summary: string }
  | { ok: false; detail?: string; needsInput?: { question: string; candidates: NamedCandidate[] } }
> {
  const executor = BOUND[capabilityId];
  if (!executor) return { ok: false };
  try {
    const outcome = await executor(context, subject);
    return { ok: true, result: outcome.result, summary: outcome.summary };
  } catch (error) {
    if (error instanceof NeedsInput) {
      // Not a failure: the capability worked exactly as designed and is
      // asking for the one thing the sentence did not carry.
      return {
        ok: false,
        needsInput: { question: error.question, candidates: error.candidates },
      };
    }
    // The person gets plain language; the detail goes to the log. A raw
    // stack trace as the primary experience is a dead end, not an answer.
    logger.warn('[Command] Execution failed', {
      capabilityId,
      workspaceId: context.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      ...(error instanceof Error && error.message
        ? { detail: `I tried to do this and it did not work: ${error.message}` }
        : {}),
    };
  }
}

/** Whether a resolved route needs a person to approve before it may run. */
export function requiresApproval(route: CommandRoute | null): boolean {
  return route ? !RUNS_WITHOUT_APPROVAL.has(route.riskClass) : false;
}

/**
 * Whether the command layer can actually drive this capability.
 *
 * Exported so the approval path can say `not-bound` rather than discovering
 * a missing executor at run time and reporting it as a failure. "Nobody
 * wired this up" and "it broke" are different sentences, and only one of
 * them sends a person looking for a bug.
 */
export function isBound(capabilityId: string | null): boolean {
  return capabilityId !== null && capabilityId in BOUND;
}

/**
 * Understand → resolve → check permission → check availability → classify
 * risk → approve-if-needed → EXECUTE → record.
 *
 * Every outcome is recorded, not just the successes: a trail that only
 * contains completions is systematically optimistic, and the refusals are
 * exactly what an operator investigating an incident needs.
 */
export async function executeCommand(
  commandText: string,
  context: ExecutionContext
): Promise<CommandExecutionResult> {
  const decision = decideCommand(commandText, context.role);
  const { understanding, route } = decision;
  let { state, detail } = decision;

  let result: unknown;
  let summary: string | undefined;
  let candidates: NamedCandidate[] | undefined;

  if (state === 'completed') {
    const outcome = await runBound(route!.capabilityId, context, understanding.subject);
    if (outcome.ok) {
      result = outcome.result;
      summary = outcome.summary;
    } else if (outcome.needsInput) {
      // Distinct from failed on purpose: the capability is fine, the
      // sentence is missing one thing, and blaming a bug would send the
      // person hunting for one.
      state = 'needs-input';
      detail = outcome.needsInput.question;
      candidates = outcome.needsInput.candidates;
    } else {
      state = 'failed';
      detail = outcome.detail;
    }
  }

  const needsApproval = requiresApproval(route);
  const record = await prisma.commandExecution.create({
    data: {
      workspaceId: context.workspaceId,
      userId: context.userId,
      commandText,
      intent: understanding.intent,
      capabilityId: route?.capabilityId ?? null,
      riskClass: route?.riskClass ?? 'read-only',
      permitted: decision.permitted,
      available: route?.availability === 'available',
      approvalRequired: needsApproval,
      approvalState: state === 'waiting-approval' ? 'pending' : 'none',
      // The deadline is stored, not derived at read time: the promise made
      // to the person waiting must be the promise the server keeps.
      approvalExpiresAt:
        state === 'waiting-approval' ? new Date(Date.now() + APPROVAL_WINDOW_MS) : null,
      state,
      resultSummary: summary ?? null,
      failureReason: state === 'completed' ? null : messageFor(state, route, detail),
      completedAt: state === 'completed' ? new Date() : null,
    },
  });

  return {
    executionId: record.id,
    state,
    understood: understanding.subject || understanding.intent,
    capabilityId: route?.capabilityId ?? null,
    riskClass: route?.riskClass ?? 'read-only',
    message: state === 'completed' ? summary! : messageFor(state, route, detail),
    ...(state === 'completed' ? { result } : {}),
    // True ONLY when a real capability actually ran.
    executed: state === 'completed',
    ...(route?.appPath ? { appPath: route.appPath } : {}),
    // The choices behind a needs-input question, as data a UI can offer.
    ...(candidates && candidates.length > 0 ? { candidates } : {}),
  };
}
