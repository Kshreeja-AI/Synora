import { prisma } from '@synora/database';
import { NotFoundException } from '@synora/shared';
import {
  APPROVAL_WINDOW_MS,
  decideCommand,
  isBound,
  messageFor,
  requiresApproval,
  runBound,
  type CommandExecutionResult,
  type ExecutionState,
} from './execute';
import { hasPermission, type Permission, type WorkspaceRole } from '../services/permissions';
import { requireMembership } from '../services/checks';
import { logger } from '../utils/logger';

/**
 * Slice 4: turning `waiting-approval` from an honest stop into a completed
 * workflow.
 *
 * Slice 3 could refuse a sensitive action and say so truthfully. It had no
 * way for a person to then say yes. This module is that yes — and almost all
 * of it is the machinery that makes a "yes" mean what everyone assumes it
 * means.
 *
 * THE FOUR WAYS AN APPROVAL SYSTEM LIES, AND WHAT STOPS EACH HERE:
 *
 * 1. The client claims approval.
 *    Nothing sent by the caller says "approved". The only approval that
 *    exists is a row in the database that this server wrote, and the only
 *    thing the caller supplies is which row they mean.
 *
 * 2. The same approval is used twice.
 *    The pending state is CLAIMED with a conditional update — a
 *    compare-and-set — and only the writer that actually changed the row
 *    proceeds. Two simultaneous approvals of one record cannot both win;
 *    an approval replayed later finds nothing left to claim.
 *
 * 3. The approval is stale.
 *    A pending record carries the deadline it was created with. Past it,
 *    the record expires instead of running. An approval is a judgement
 *    about a moment, and someone answering a week later is no longer
 *    answering the same question.
 *
 * 4. The approved action is not the executed action.
 *    THE IMPORTANT ONE. The action is re-derived from the STORED command
 *    text and must still resolve to the SAME capability, the same risk
 *    class, and the same requirement for approval. The approve request has
 *    no field that can influence what runs — there is deliberately nothing
 *    to tamper with. If the catalogue changed underneath a pending record,
 *    it does not run; it is refused for re-issue.
 *
 * And one that is not about tampering at all: the ORIGINAL requester's
 * permission is re-checked at the moment of execution. Roles change while
 * things sit in queues, and an action runs as the person who asked for it,
 * not as the person who approved it.
 */

/** A decision only ever moves a record out of `pending`, never back into it. */
export type ApprovalDecision = 'approved' | 'rejected';

export interface ApprovalOutcome extends CommandExecutionResult {
  /** Who decided, so a caller never has to infer it from the request. */
  decidedBy: string;
  decision: ApprovalDecision | 'refused';
}

/**
 * Refused for a reason that is about the REQUEST, not about the action: the
 * record is gone, already decided, expired, or the approver may not approve
 * it. Distinct from the action itself failing.
 */
export class ApprovalRefused extends Error {
  constructor(
    readonly userMessage: string,
    readonly state: ExecutionState | 'already-decided'
  ) {
    super(userMessage);
    this.name = 'ApprovalRefused';
  }
}

interface ApprovalContext {
  /** The person clicking approve or reject — NOT necessarily the requester. */
  approverId: string;
  approverRole: WorkspaceRole;
  workspaceId: string;
}

/**
 * Loads a pending record, scoped to the workspace in the URL.
 *
 * Workspace-scoped by id AND workspaceId together: a record id from another
 * workspace must be indistinguishable from one that does not exist, or the
 * id itself becomes a probe for what exists elsewhere.
 */
async function loadPending(executionId: string, workspaceId: string) {
  const record = await prisma.commandExecution.findFirst({
    where: { id: executionId, workspaceId },
  });
  if (!record) throw new NotFoundException('Command execution not found');
  return record;
}

/**
 * Marks a record expired. Called lazily, when someone touches an
 * out-of-date record, rather than by a sweeper: a background job that
 * expires things is one more moving part that can be down, and a record
 * whose stored state disagrees with what the server would do is its own
 * kind of dishonesty. Converging on access keeps the two identical at
 * exactly the moment it matters.
 */
async function expire(executionId: string): Promise<void> {
  await prisma.commandExecution.updateMany({
    // `deciding` is included so a claim abandoned by a crashed process
    // self-heals at the deadline instead of leaving the record permanently
    // unactionable. Nothing legitimate holds a claim for a whole day, so
    // this can never expire a decision that is genuinely in flight.
    where: { id: executionId, approvalState: { in: ['pending', 'deciding'] } },
    data: {
      approvalState: 'expired',
      state: 'expired',
      failureReason: messageFor('expired', null),
      completedAt: new Date(),
    },
  });
}

export function isExpired(record: {
  approvalExpiresAt: Date | null;
  createdAt: Date;
}): boolean {
  // Records created before deadlines were stored fall back to the same
  // window measured from creation — an absent deadline must not read as
  // "never expires", which is the most permissive possible interpretation
  // of missing data.
  const deadline = record.approvalExpiresAt ?? new Date(record.createdAt.getTime() + APPROVAL_WINDOW_MS);
  return Date.now() > deadline.getTime();
}

/**
 * Approve or reject a pending command execution.
 *
 * Approving RUNS the action, in the same server-side transition that
 * records the approval. There is deliberately no window in which an
 * approval exists but has not been used — a stored, unspent approval is a
 * credential, and a credential sitting in a database is a thing to steal.
 */
export async function decideExecution(
  executionId: string,
  decision: ApprovalDecision,
  context: ApprovalContext,
  rejectionReason?: string
): Promise<ApprovalOutcome> {
  const record = await loadPending(executionId, context.workspaceId);

  // A claim held by another request in flight — or abandoned by one that
  // crashed. Named separately from a finished decision because "someone is
  // deciding this right now" and "this was already decided" are different
  // facts, and telling a person the wrong one wastes their time.
  if (record.approvalState === 'deciding') {
    if (isExpired(record)) {
      await expire(record.id);
      throw new ApprovalRefused(messageFor('expired', null), 'expired');
    }
    throw new ApprovalRefused(
      'This is being decided right now. Nothing was done twice.',
      'already-decided'
    );
  }

  if (record.approvalState !== 'pending' || record.state !== 'waiting-approval') {
    // Deliberately says what happened rather than silently succeeding. A
    // second approver arriving after the first must learn that the decision
    // is already made, not be told "done" for work they did not cause.
    throw new ApprovalRefused(
      `This was already decided — it is ${record.approvalState}. Nothing was done again.`,
      'already-decided'
    );
  }

  if (isExpired(record)) {
    await expire(record.id);
    throw new ApprovalRefused(messageFor('expired', null), 'expired');
  }

  // --- Re-derive the action from the RECORD, never from the request. ---
  //
  // The approver may be a different person with a different role, so the
  // requester's role is what decides whether the action is permitted. The
  // approver's own authority is checked separately, below.
  const requester = await requireMembership(record.userId, record.workspaceId).catch(() => null);
  const freshDecision = requester
    ? decideCommand(record.commandText, requester.role)
    : null;

  if (decision === 'approved') {
    if (!requester || !freshDecision) {
      throw new ApprovalRefused(
        'The person who asked for this is no longer in this workspace, so it was not done.',
        'not-authorized'
      );
    }

    // ORDER MATTERS HERE, and it is a correctness property rather than a
    // style choice: the most SPECIFIC reason must win. A requester who was
    // demoted while their request sat in the queue is not "the action
    // changed" — reporting it that way sends someone hunting for a change
    // to the command that never happened.
    if (!freshDecision.permitted) {
      throw new ApprovalRefused(
        'The person who asked for this no longer has permission to do it, so it was not done.',
        'not-authorized'
      );
    }

    // THE CENTRAL CHECK: is the thing about to run still the thing that was
    // approved? The identity of the action — which capability, at what risk,
    // still needing approval at all — must match what was recorded. Any
    // drift and this does not run; it is refused for re-issue, because a
    // fresh request gets a fresh, correct answer.
    const drifted =
      freshDecision.route?.capabilityId !== record.capabilityId ||
      freshDecision.route?.riskClass !== record.riskClass ||
      !requiresApproval(freshDecision.route);

    if (drifted) {
      logger.warn('[Command] Approval refused: action no longer matches the approved record', {
        executionId: record.id,
        recordedCapability: record.capabilityId,
        resolvedCapability: freshDecision.route?.capabilityId ?? null,
        recordedRisk: record.riskClass,
        resolvedRisk: freshDecision.route?.riskClass ?? null,
        resolvedState: freshDecision.state,
      });
      throw new ApprovalRefused(
        'What this would do has changed since it was requested, so it was not done. Ask again to get a fresh answer.',
        'expired'
      );
    }

    // The approver must be able to do the thing themselves. Approving is
    // not a way to launder a capability through someone else's request:
    // you cannot authorize what you would not be allowed to perform.
    const needed = freshDecision.route!.requiredPermission;
    if (needed !== null && !hasPermission(context.approverRole, needed as Permission)) {
      throw new ApprovalRefused(
        `You cannot approve this — approving it needs "${needed}", which you do not have.`,
        'not-authorized'
      );
    }

    // A credential that vanished between request and approval. Reporting
    // this as a failure would send an operator looking for a broken
    // capability instead of a missing configuration.
    if (freshDecision.route!.availability !== 'available') {
      throw new ApprovalRefused(messageFor('unavailable', freshDecision.route), 'unavailable');
    }
  }

  // --- Claim the decision. Compare-and-set, not read-then-write. ---
  //
  // Two people pressing approve at the same moment both passed the checks
  // above; exactly one may proceed. `updateMany` with the expected state in
  // the WHERE clause makes the database the arbiter, and the loser sees
  // count === 0 rather than a second execution.
  const claim = await prisma.commandExecution.updateMany({
    where: { id: record.id, approvalState: 'pending' },
    data: { approvalState: 'deciding' },
  });
  if (claim.count === 0) {
    throw new ApprovalRefused(
      'Someone else answered this at the same moment. Nothing was done twice.',
      'already-decided'
    );
  }

  const now = new Date();

  if (decision === 'rejected') {
    const updated = await prisma.commandExecution.update({
      where: { id: record.id },
      data: {
        approvalState: 'rejected',
        rejectedBy: context.approverId,
        rejectedAt: now,
        rejectionReason: rejectionReason ?? null,
        state: 'rejected',
        failureReason: messageFor(
          'rejected',
          null,
          rejectionReason ? `This was refused: ${rejectionReason}` : undefined
        ),
        completedAt: now,
      },
    });
    return {
      executionId: updated.id,
      state: 'rejected',
      understood: record.commandText,
      capabilityId: record.capabilityId,
      riskClass: record.riskClass,
      message: updated.failureReason!,
      executed: false,
      decidedBy: context.approverId,
      decision: 'rejected',
    };
  }

  // Approved. The approval itself is now a fact and is recorded as one, even
  // when the action cannot proceed — a person said yes, and the trail must
  // show that they did.
  //
  // `not-bound` is checked BEFORE running rather than inferred from a
  // missing executor afterwards. "Nobody wired this up yet" reported as
  // "it failed" is how an owner spends an afternoon looking for a bug that
  // does not exist. Today every sensitive capability is unbound, so this is
  // the honest outcome of approving one — not a theoretical branch.
  if (!isBound(record.capabilityId)) {
    const updated = await prisma.commandExecution.update({
      where: { id: record.id },
      data: {
        approvalState: 'approved',
        approvedBy: context.approverId,
        approvedAt: now,
        state: 'not-bound',
        failureReason: messageFor('not-bound', freshDecision!.route),
        completedAt: now,
      },
    });
    return {
      executionId: updated.id,
      state: 'not-bound',
      understood: freshDecision!.understanding.subject || freshDecision!.understanding.intent,
      capabilityId: record.capabilityId,
      riskClass: record.riskClass,
      message: updated.failureReason!,
      executed: false,
      decidedBy: context.approverId,
      decision: 'approved',
    };
  }

  // Run it AS THE ORIGINAL REQUESTER — the action belongs to the person who
  // asked for it, and it must land in the audit trail of every downstream
  // service under their name, not the approver's.
  const outcome = await runBound(
    freshDecision!.route!.capabilityId,
    { userId: record.userId, workspaceId: record.workspaceId, role: requester!.role },
    freshDecision!.understanding.subject
  );

  // Three honest outcomes of an approved run, never collapsed: it ran, it
  // needs one more detail (the capability is FINE — blaming a bug would
  // send someone hunting for one), or it genuinely broke.
  const finalState: ExecutionState = outcome.ok
    ? 'completed'
    : outcome.needsInput
      ? 'needs-input'
      : 'failed';
  const updated = await prisma.commandExecution.update({
    where: { id: record.id },
    data: {
      approvalState: 'approved',
      approvedBy: context.approverId,
      approvedAt: now,
      state: finalState,
      resultSummary: outcome.ok ? outcome.summary : null,
      failureReason: outcome.ok
        ? null
        : outcome.needsInput
          ? outcome.needsInput.question
          : messageFor('failed', freshDecision!.route, outcome.detail),
      completedAt: new Date(),
    },
  });

  return {
    executionId: updated.id,
    state: finalState,
    understood: freshDecision!.understanding.subject || freshDecision!.understanding.intent,
    capabilityId: record.capabilityId,
    riskClass: record.riskClass,
    message: outcome.ok ? outcome.summary : updated.failureReason!,
    ...(outcome.ok ? { result: outcome.result } : {}),
    executed: outcome.ok,
    decidedBy: context.approverId,
    decision: 'approved',
  };
}

export interface ExecutionListItem {
  id: string;
  commandText: string;
  capabilityId: string | null;
  riskClass: string;
  state: string;
  approvalState: string;
  approvalExpiresAt: Date | null;
  requestedBy: string;
  createdAt: Date;
  message: string | null;
}

/**
 * Recent command executions in a workspace.
 *
 * Exists because an approval nobody can find is an approval that never
 * happens: without this, `waiting-approval` would be a state the system
 * could enter and no person could ever leave.
 *
 * You always see your OWN commands. Seeing everyone's is the same question
 * as reading the workspace's activity, so it takes the same permission
 * (`audit:view`) rather than a new one invented here — a second vocabulary
 * for the same authority is how two answers to one question appear.
 */
export async function listExecutions(
  workspaceId: string,
  viewerId: string,
  viewerRole: WorkspaceRole,
  options: { pendingOnly?: boolean; take?: number } = {}
): Promise<ExecutionListItem[]> {
  const seesEveryone = hasPermission(viewerRole, 'audit:view');
  const rows = await prisma.commandExecution.findMany({
    where: {
      workspaceId,
      ...(seesEveryone ? {} : { userId: viewerId }),
      ...(options.pendingOnly ? { approvalState: 'pending', state: 'waiting-approval' } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.take ?? 50, 100),
  });

  return rows.map((row) => ({
    id: row.id,
    commandText: row.commandText,
    capabilityId: row.capabilityId,
    riskClass: row.riskClass,
    // A pending row past its deadline is reported as expired even before
    // the write converges. Showing "waiting for you" for something that can
    // no longer be approved would invite a click that cannot work.
    state: row.state === 'waiting-approval' && isExpired(row) ? 'expired' : row.state,
    approvalState: row.approvalState === 'pending' && isExpired(row) ? 'expired' : row.approvalState,
    approvalExpiresAt: row.approvalExpiresAt,
    requestedBy: row.userId,
    createdAt: row.createdAt,
    message: row.resultSummary ?? row.failureReason,
  }));
}
