'use client';

import Link from 'next/link';
import type { CommandOutcome, CommandState } from '@/lib/api/command';

/**
 * What Synora did, or did not do, and why.
 *
 * THE ONE RULE THIS COMPONENT EXISTS TO ENFORCE: the nine server states are
 * never collapsed into "success" and "error". The backend went to
 * considerable trouble to keep "I am not connected to that", "you are not
 * allowed", "nobody has wired that up", "a person must approve first" and
 * "it broke" apart, and a UI with a green tick and a red cross would throw
 * all of it away at the last step — leaving the person back where they
 * started, guessing whether anything happened.
 *
 * Each state gets its own wording and its own next step, because each has a
 * genuinely different next step:
 *
 *   completed        nothing to do — here is the result
 *   waiting-approval someone must decide; the work has not started
 *   not-authorized   ask for a specific permission, by name
 *   unavailable      a credential is missing; no amount of retrying helps
 *   not-implemented  rephrasing will not help either; Synora cannot do it
 *   not-bound        Synora CAN do it — go do it in the app
 *   rejected         a person said no
 *   expired          nobody answered in time; ask again
 *   failed           it genuinely broke; retrying may work
 *
 * The message itself is composed SERVER-SIDE and rendered verbatim. The
 * server is the only thing that knows why it refused, and a second wording
 * of the same rule in the client is a second thing to keep in sync — which
 * eventually disagrees, always in front of a user.
 */

/**
 * Facts, not verdicts. Nothing here grades an outcome as good or bad; the
 * label states which of the nine things happened, and the person decides
 * how they feel about it.
 */
const LABEL: Record<CommandState, string> = {
  completed: 'Done',
  'waiting-approval': 'Waiting for approval',
  'not-authorized': 'Not allowed',
  unavailable: 'Not connected here',
  'not-implemented': 'Synora cannot do this',
  'not-bound': 'Available in the app',
  rejected: 'Refused',
  expired: 'Expired',
  failed: 'Did not work',
};

/**
 * Tone, deliberately coarse. Three visual treatments for nine states —
 * enough to see at a glance whether something happened, never enough to
 * substitute for reading the sentence. Colour that encoded all nine would
 * be a second vocabulary to learn, and an inaccessible one.
 */
function toneFor(state: CommandState): string {
  if (state === 'completed') return 'border-l-4 border-l-green-600';
  if (state === 'waiting-approval') return 'border-l-4 border-l-amber-500';
  return 'border-l-4 border-l-muted-foreground';
}

export function CommandOutcomeCard({ outcome }: { outcome: CommandOutcome }) {
  return (
    <section
      className={`space-y-2 rounded-md border p-4 ${toneFor(outcome.state)}`}
      aria-labelledby="command-outcome-heading"
      data-testid="command-outcome"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="command-outcome-heading" className="font-semibold">
          {LABEL[outcome.state]}
        </h2>
        {/* The capability is shown as a fact for anyone who wants it, not
            as the headline. A person asked for an outcome, not for
            "search.workspace". */}
        {outcome.capabilityId && (
          <span className="text-xs text-muted-foreground">{outcome.capabilityId}</span>
        )}
      </div>

      <p className="text-sm">{outcome.message}</p>

      {/* Stated explicitly, every time, in both directions. The whole
          layer exists so nobody has to infer this from the tone of a
          sentence. */}
      <p className="text-xs text-muted-foreground">
        {outcome.executed
          ? 'This ran, and the result above is real.'
          : 'Nothing was done. Synora did not run anything for this.'}
      </p>

      {/* A refusal with nowhere to go is a dead end. When Synora knows the
          page, it is a link — offered on refusals, where it is the next
          step, and NOT on a completed action, where it would invite
          someone to go and redo work that just happened. */}
      {outcome.appPath && !outcome.executed && (
        <p className="text-sm">
          <Link href={outcome.appPath} className="underline underline-offset-2">
            Do this yourself in the app
          </Link>
        </p>
      )}

      {outcome.executed && outcome.result !== undefined && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">What came back</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2">
            {JSON.stringify(outcome.result, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}

export { LABEL as COMMAND_STATE_LABEL };
