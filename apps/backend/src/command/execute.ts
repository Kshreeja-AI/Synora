import { prisma } from '@synora/database';
import { prepareCommand } from './prepare';
import { getTextProviderMetrics } from '../ai/textResilience';
import { searchService } from '../services/search.service';
import { conversationService } from '../services/conversation.service';
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
  | 'failed';

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
function messageFor(state: ExecutionState, route: CommandRoute | null, detail?: string): string {
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
      return 'Synora can do this, but not yet by being asked in plain language. It is available in the app itself.';
    case 'waiting-approval':
      return 'I can do this, and it needs your approval first because it changes something outside Synora or affects other people.';
    case 'failed':
      return detail ?? 'I tried to do this and it did not work.';
    default:
      return 'Done.';
  }
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
  const prepared = prepareCommand(commandText, context.role);
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

  let result: unknown;
  let summary: string | undefined;

  if (state === 'completed') {
    try {
      const outcome = await BOUND[route!.capabilityId](context, understanding.subject);
      result = outcome.result;
      summary = outcome.summary;
    } catch (error) {
      state = 'failed';
      // The person gets plain language; the detail goes to the log. A raw
      // stack trace as the primary experience is a dead end, not an answer.
      logger.warn('[Command] Execution failed', {
        capabilityId: route!.capabilityId,
        workspaceId: context.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      detail =
        error instanceof Error && error.message
          ? `I tried to do this and it did not work: ${error.message}`
          : undefined;
    }
  }

  const record = await prisma.commandExecution.create({
    data: {
      workspaceId: context.workspaceId,
      userId: context.userId,
      commandText,
      intent: understanding.intent,
      capabilityId: route?.capabilityId ?? null,
      riskClass: route?.riskClass ?? 'read-only',
      permitted: candidate?.permitted ?? false,
      available: route?.availability === 'available',
      approvalRequired: route ? !RUNS_WITHOUT_APPROVAL.has(route.riskClass) : false,
      approvalState: state === 'waiting-approval' ? 'pending' : 'none',
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
  };
}
