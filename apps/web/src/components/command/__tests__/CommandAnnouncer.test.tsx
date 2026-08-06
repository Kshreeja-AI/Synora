/**
 * Saying the answer out loud.
 *
 * The property under test is the one the page's whole promise rests on:
 * every outcome reaches a person who cannot see the screen, in the SERVER's
 * words, with the state named. A live region that stays silent is exactly
 * as bad as no live region, and it is the easy mistake to make — so several
 * of these assert that it speaks at all.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandAnnouncer, commandAnnouncement } from '../CommandAnnouncer';
import type { CommandOutcome, PlanRunResult, UndoOutcome } from '@/lib/api/command';

function outcome(overrides: Partial<CommandOutcome> = {}): CommandOutcome {
  return {
    executionId: 'exec_1',
    state: 'completed',
    understood: 'onboarding',
    capabilityId: 'search.workspace',
    riskClass: 'read-only',
    message: 'Found 3 results for "onboarding".',
    executed: true,
    ...overrides,
  };
}

const QUIET = {
  pending: false,
  outcome: null,
  planResult: null,
  undoResult: null,
  unreachable: false,
};

describe('CommandAnnouncer', () => {
  it('is in the document before anything happens', () => {
    // A live region mounted at the same moment its content appears is not
    // announced by assistive technology. Conditionally rendering the region
    // is the classic way to build one that never speaks.
    render(<CommandAnnouncer {...QUIET} />);
    const region = screen.getByTestId('command-announcer');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('');
  });

  it('announces which of the ten states this is, then why', () => {
    render(<CommandAnnouncer {...QUIET} outcome={outcome({ state: 'not-authorized', message: 'You do not have permission.' })} />);
    // The state name first: a person needs to know WHICH answer this is
    // before the sentence explaining it.
    expect(screen.getByTestId('command-announcer')).toHaveTextContent(
      'Not allowed. You do not have permission.',
    );
  });

  it('never collapses a refusal into a generic failure', () => {
    // Same discipline as the visible card. "Not connected here" and "Did
    // not work" send a person to completely different places, and someone
    // listening must get the same distinction as someone looking.
    const spoken = (state: CommandOutcome['state']) =>
      commandAnnouncement({ ...QUIET, outcome: outcome({ state, executed: false }) });

    expect(spoken('unavailable')).toContain('Not connected here');
    expect(spoken('failed')).toContain('Did not work');
    expect(spoken('waiting-approval')).toContain('Waiting for approval');
    expect(spoken('not-bound')).toContain('Available in the app');
  });

  it('says something while a slow request is in flight', () => {
    // Silence during a slow request is indistinguishable from a page that
    // ignored the button press.
    render(<CommandAnnouncer {...QUIET} pending />);
    expect(screen.getByTestId('command-announcer')).toHaveTextContent(/working on it/i);
  });

  it('reports a partial plan as partial, including where it stopped', () => {
    const planResult: PlanRunResult = {
      planId: 'p1',
      status: 'partially-completed',
      originalText: 'do things',
      steps: [],
      summary: '1 of 2 done, then I stopped.',
      stoppedAtStep: 2,
      stoppedReason: 'Not connected.',
      completedCount: 1,
      safeToRetry: false,
    };
    render(<CommandAnnouncer {...QUIET} planResult={planResult} />);
    const region = screen.getByTestId('command-announcer');
    // Both halves. "1 of 2 done" without the reason leaves a person unable
    // to act; the reason without the count hides that anything ran at all.
    expect(region).toHaveTextContent('1 of 2 done');
    expect(region).toHaveTextContent('Stopped at step 2: Not connected.');
  });

  it('lets an undo result win over the action it reversed', () => {
    const undoResult: UndoOutcome = {
      executionId: 'exec_1',
      undone: true,
      kind: 'conversation',
      message: 'Removed the conversation "Pricing".',
      undoneAt: '2026-08-06T00:00:00.000Z',
    };
    render(<CommandAnnouncer {...QUIET} outcome={outcome()} undoResult={undoResult} />);
    // Announcing the original outcome here would describe the very thing
    // that was just taken back.
    expect(screen.getByTestId('command-announcer')).toHaveTextContent(/Removed the conversation/);
    expect(screen.getByTestId('command-announcer')).not.toHaveTextContent(/Found 3 results/);
  });

  it('does not claim an unreachable undo either worked or did not', () => {
    render(<CommandAnnouncer {...QUIET} outcome={outcome()} unreachable />);
    const spoken = screen.getByTestId('command-announcer').textContent ?? '';
    // The claim must be HEDGED. A request that never arrived may still have
    // been carried out before the connection dropped, so both "it worked"
    // and "nothing happened" are guesses dressed as facts.
    expect(spoken).toMatch(/not clear whether/i);
    expect(spoken).not.toMatch(/nothing was undone/i);
    // And it must not announce the reversed action's own success either,
    // which would read as confirmation.
    expect(spoken).not.toMatch(/^Removed |^Undone/i);
  });

  it('speaks the server words rather than composing its own', () => {
    // The server is the only thing that knows why it refused. A second
    // wording of the same rule is a second thing to keep in sync, and the
    // two would eventually disagree in front of the person who cannot see
    // the one that is right.
    const message = 'A very specific server sentence about a missing credential.';
    const spoken = commandAnnouncement({
      ...QUIET,
      outcome: outcome({ state: 'unavailable', message, executed: false }),
    });
    expect(spoken).toContain(message);
  });
});
