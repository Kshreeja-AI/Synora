'use client';

import { COMMAND_STATE_LABEL } from './CommandOutcome';
import type {
  CommandOutcome,
  PlanRunResult,
  UndoOutcome,
} from '@/lib/api/command';

/**
 * Says the answer out loud.
 *
 * WHY THIS EXISTS, and it is not a polish item. This page's entire promise
 * is "Synora tells you exactly what it did, or exactly why it did not."
 * Every answer was being inserted silently into the page: a person using a
 * screen reader pressed "Do it", focus stayed in the text box, and nothing
 * was announced. They were told nothing at all — on the one surface built
 * specifically to never leave anyone guessing.
 *
 * The layer goes to real trouble keeping ten outcomes distinct. Delivering
 * them in a form an entire class of user cannot perceive undoes all of that
 * at the last step, in exactly the way a green tick and a red cross would.
 *
 * THE SAME PIPELINE, NOT A SECOND ONE. Per the standing rule that every
 * input and output path resolves through one architecture, this announces
 * the SERVER's own words — `outcome.message` verbatim, and the label from
 * the same `COMMAND_STATE_LABEL` map the visible card uses. It composes no
 * new prose. A second wording of the same outcome is a second thing to keep
 * in sync, and the two would eventually disagree in front of a person who
 * cannot see the one that is right.
 *
 * WHY A LIVE REGION AND NOT MOVING FOCUS. Both are legitimate. Focus is
 * seized here only if the person is likely to have moved on, and they have
 * not — they pressed a button and are waiting. Yanking focus out of the
 * text box would also discard the caret position of anyone who was about to
 * edit their sentence after a refusal, which is precisely the case the page
 * already takes care to support by not clearing the box.
 *
 * `polite`, not `assertive`: an answer to something you asked for should
 * wait its turn rather than interrupt whatever is mid-sentence.
 */

/**
 * One sentence, assembled from parts the server already decided.
 *
 * Returns null when there is nothing new to say. An empty live region is
 * silent, which is correct — a region that re-announced the same thing on
 * every render would be unusable.
 */
function announcement({
  pending,
  outcome,
  planResult,
  undoResult,
  unreachable,
}: {
  pending: boolean;
  outcome: CommandOutcome | null;
  planResult: PlanRunResult | null;
  undoResult: UndoOutcome | null;
  unreachable: boolean;
}): string | null {
  // Ordered most-recent-event-first. Undoing happens after an outcome
  // exists, so it must win, or the announcement would describe the action
  // that was just reversed.
  if (undoResult) return undoResult.message;
  if (unreachable) {
    return 'That did not reach Synora, so it is not clear whether this was undone.';
  }
  if (pending) {
    // Said at all because silence during a slow request is indistinguishable
    // from a page that ignored the button.
    return 'Working on it.';
  }
  if (planResult) {
    // `summary` is the server's own count sentence ("1 of 2 done, then I
    // stopped"), and `stoppedReason` is why. Both matter and neither can be
    // inferred from the other.
    return planResult.stoppedReason
      ? `${planResult.summary} Stopped at step ${planResult.stoppedAtStep}: ${planResult.stoppedReason}`
      : planResult.summary;
  }
  if (outcome) {
    // Label first, then the reason. Which of the ten states this is, is the
    // fact a person needs before the sentence explaining it.
    const label = COMMAND_STATE_LABEL[outcome.state] ?? outcome.state;
    return `${label}. ${outcome.message}`;
  }
  return null;
}

export function CommandAnnouncer(props: {
  pending: boolean;
  outcome: CommandOutcome | null;
  planResult: PlanRunResult | null;
  undoResult: UndoOutcome | null;
  unreachable: boolean;
}) {
  const text = announcement(props);
  return (
    // Rendered ALWAYS, even when empty. A live region must be in the
    // document before its content changes, or the change is not announced —
    // conditionally mounting the region is the classic way to build one
    // that never speaks.
    <div role="status" aria-live="polite" className="sr-only" data-testid="command-announcer">
      {text}
    </div>
  );
}

export { announcement as commandAnnouncement };
