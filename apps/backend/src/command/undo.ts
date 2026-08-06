import { prisma } from '@synora/database';
import { NotFoundException } from '@synora/shared';
import { conversationService } from '../services/conversation.service';
import { deleteScheduleAuthorized } from '../workflows/schedule-authorized';
import { requireMembership } from '../services/checks';
import { logger } from '../utils/logger';

/**
 * Slice 19: undo as a capability, not as an adjective.
 *
 * Until now the command layer REASONED about reversibility — `reversible`
 * is a risk class, it is why creating a conversation runs without an
 * approval gate, and the whole approval policy leans on it. But nothing in
 * the system could actually reverse anything. "This is reversible" was a
 * claim about a person's ability to go and undo it by hand somewhere else,
 * dressed up as a property of the action.
 *
 * That gap is the exact shape of the thing this project keeps refusing to
 * ship: a word in the interface that the machinery behind it does not back.
 *
 * WHAT UNDO IS NOT ALLOWED TO BE:
 *
 * 1. A guess. The executor that performed the action declares what would
 *    reverse it, at the moment it performs it, and that declaration is
 *    stored. Undo never infers a target from a capability id or parses one
 *    back out of the summary prose — a wrong guess here deletes the wrong
 *    thing, which is the single worst outcome this module can produce.
 *
 * 2. A second authority. Undoing re-checks permission AT UNDO TIME, through
 *    the same service-level checks the original action went through. Having
 *    once been allowed to create something is not standing permission to
 *    delete it later, and a role that changed in between must win.
 *
 * 3. A way to act twice. An execution can be undone once. The record
 *    carries when and by whom, and a second attempt is refused rather than
 *    quietly repeated — the same discipline the approval path uses, for the
 *    same reason: a repeated side effect nobody intended is indisputably
 *    worse than an error message.
 *
 * 4. Available for everything. Most actions cannot be reversed, and this
 *    says so plainly instead of offering a button that would fail. An
 *    irreversible action with an undo button is a lie told in advance.
 */

export type UndoRefusalReason =
  | 'not-reversible'
  | 'already-undone'
  | 'not-completed';

/**
 * Refused for a reason about the REQUEST or the RECORD, never a malfunction.
 * Separate from a thrown service error so the route can answer "no, and here
 * is why" rather than presenting a legitimate refusal as a broken server.
 */
export class UndoRefused extends Error {
  constructor(
    readonly userMessage: string,
    readonly reason: UndoRefusalReason
  ) {
    super(userMessage);
    this.name = 'UndoRefused';
  }
}

export interface UndoContext {
  userId: string;
  workspaceId: string;
}

export interface UndoResult {
  executionId: string;
  undone: true;
  /** What kind of thing was reversed, in the vocabulary the executor used. */
  kind: string;
  message: string;
  undoneAt: Date;
}

/**
 * Performs the reversal declared by whichever executor did the original
 * work.
 *
 * Each arm calls a service that runs its OWN membership and permission
 * checks — `conversationService.delete` enforces `conversation:manage`,
 * `deleteScheduleAuthorized` enforces `tool:manage`. That is deliberate and
 * is the authoritative check: this module does not hold a second, parallel
 * opinion about who may delete what, because two opinions eventually
 * disagree and the more permissive one wins by accident.
 */
async function performUndo(
  kind: string,
  targetId: string,
  context: UndoContext
): Promise<string> {
  switch (kind) {
    case 'conversation': {
      // A soft delete, which is what the conversation service does and what
      // this therefore reports. Saying "deleted" for something recoverable
      // in the product would misdescribe it in the other direction.
      const conversation = await conversationService.delete(context.userId, targetId);
      return `Removed the conversation "${conversation.title}".`;
    }
    case 'schedule': {
      const removed = await deleteScheduleAuthorized(
        context.userId,
        context.workspaceId,
        targetId
      );
      if (!removed) {
        // Gone already — by hand, on the Workflows page, or by another undo.
        // The end state the person wanted is the end state that exists, so
        // this is not an error, but it must not claim to have done the work.
        return 'That schedule was already gone, so there was nothing left to remove.';
      }
      return 'Removed the schedule, so it will not run again.';
    }
    default:
      // A kind stored by a version of the code this one does not know. It
      // refuses rather than improvising: the whole point of a declared
      // target is that undo never invents what to do with it.
      throw new UndoRefused(
        'Synora does not know how to reverse this kind of action.',
        'not-reversible'
      );
  }
}

/**
 * Reverse a completed command execution.
 *
 * Workspace-scoped by id AND workspaceId together, so an execution id from
 * another workspace is indistinguishable from one that does not exist. The
 * id itself must never become a probe for what exists elsewhere.
 */
export async function undoExecution(
  executionId: string,
  context: UndoContext
): Promise<UndoResult> {
  const record = await prisma.commandExecution.findFirst({
    where: { id: executionId, workspaceId: context.workspaceId },
  });
  if (!record) throw new NotFoundException('Command execution not found');

  // Membership before anything else. Everything below reads the record's
  // content, and someone who is not in this workspace must learn nothing
  // about it — including whether it is reversible.
  await requireMembership(context.userId, context.workspaceId);

  if (record.undoneAt) {
    throw new UndoRefused(
      'This was already undone, so nothing was done again.',
      'already-undone'
    );
  }

  if (record.state !== 'completed') {
    // Nothing ran, so there is nothing to reverse. Offering to undo a
    // refused or failed action would imply it had had an effect.
    throw new UndoRefused(
      `This did not happen — it is ${record.state} — so there is nothing to undo.`,
      'not-completed'
    );
  }

  if (!record.undoKind || !record.undoTargetId) {
    throw new UndoRefused(
      'This action cannot be undone by Synora. Nothing was changed.',
      'not-reversible'
    );
  }

  const message = await performUndo(record.undoKind, record.undoTargetId, context);
  const undoneAt = new Date();

  // CLAIMED with a conditional update, not a read-then-write. Two undo
  // requests racing must not both record themselves as the one that did it.
  //
  // THE ORDER IS DELIBERATE — reverse first, record second — and it is the
  // opposite of the approval path's order. Both choices follow from asking
  // which lie a crash in the middle would leave behind. Record-then-reverse
  // would leave a record saying "undone" for something still there, and
  // would refuse every later attempt to fix it; reverse-then-record leaves
  // a record saying "not undone" for something already gone, and the worst
  // that a retry costs is a second attempt at a reversal that is a no-op
  // the second time. The schedule arm says so explicitly, and a
  // conversation already at DELETED is returned unchanged. A stale "not
  // yet" is recoverable; a false "already done" is not.
  const claim = await prisma.commandExecution.updateMany({
    where: { id: record.id, undoneAt: null },
    data: { undoneAt, undoneBy: context.userId },
  });
  if (claim.count === 0) {
    throw new UndoRefused(
      'Someone else undid this at the same moment. Nothing was done twice.',
      'already-undone'
    );
  }

  logger.info('[Command] Execution undone', {
    executionId: record.id,
    workspaceId: context.workspaceId,
    capabilityId: record.capabilityId,
    undoKind: record.undoKind,
  });

  return {
    executionId: record.id,
    undone: true,
    kind: record.undoKind,
    message,
    undoneAt,
  };
}
