/**
 * The outcome card.
 *
 * The property under test that matters most: the nine server states are
 * never collapsed. The backend went to real trouble keeping "not connected",
 * "not allowed", "nobody wired it up", "a person must approve" and "it
 * broke" apart; a UI with a tick and a cross would throw that away at the
 * very last step and put the person back to guessing.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandOutcomeCard } from '../CommandOutcome';
import type { CommandOutcome, CommandState } from '@/lib/api/command';

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

const ALL_STATES: CommandState[] = [
  'completed',
  'not-authorized',
  'unavailable',
  'not-implemented',
  'not-bound',
  'waiting-approval',
  'needs-input',
  'rejected',
  'expired',
  'failed',
];

describe('CommandOutcomeCard', () => {
  it('gives every one of the nine states its own distinct wording', () => {
    const labels = new Set<string>();
    for (const state of ALL_STATES) {
      const { unmount } = render(
        <CommandOutcomeCard outcome={outcome({ state, executed: state === 'completed' })} />,
      );
      labels.add(screen.getByRole('heading', { level: 2 }).textContent ?? '');
      unmount();
    }
    // Nine states in, nine distinct headings out. Any collapse here is the
    // exact failure this component exists to prevent.
    expect(labels.size).toBe(ALL_STATES.length);
  });

  it('says plainly that nothing ran, for every state that did not run', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'completed')) {
      const { unmount } = render(
        <CommandOutcomeCard outcome={outcome({ state, executed: false })} />,
      );
      expect(screen.getByText(/Nothing was done/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders the server's sentence verbatim rather than rewording it", () => {
    // A second wording of the same rule in the client is a second thing to
    // keep in sync, and it eventually disagrees in front of a user.
    const message = 'I can do this, but it is not connected in this deployment yet.';
    render(<CommandOutcomeCard outcome={outcome({ state: 'unavailable', executed: false, message })} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('only shows a result when something actually ran', () => {
    const { unmount } = render(
      <CommandOutcomeCard
        outcome={outcome({ state: 'waiting-approval', executed: false, result: { leaked: true } })}
      />,
    );
    expect(screen.queryByText(/What came back/i)).not.toBeInTheDocument();
    unmount();

    render(<CommandOutcomeCard outcome={outcome({ result: { total: 3 } })} />);
    expect(screen.getByText(/What came back/i)).toBeInTheDocument();
    expect(screen.getByText(/This ran, and the result above is real/i)).toBeInTheDocument();
  });

  it('offers a way forward on a refusal, and only on a refusal', () => {
    const { unmount } = render(
      <CommandOutcomeCard
        outcome={outcome({ state: 'not-bound', executed: false, appPath: '/agents' })}
      />,
    );
    // A refusal with nowhere to go is a dead end.
    expect(screen.getByRole('link', { name: /do this yourself/i })).toHaveAttribute(
      'href',
      '/agents',
    );
    unmount();

    render(<CommandOutcomeCard outcome={outcome({ appPath: '/search' })} />);
    // Not after something ran: that would invite someone to go redo work
    // that just happened.
    expect(screen.queryByRole('link', { name: /do this yourself/i })).not.toBeInTheDocument();
  });

  it('states no verdict about whether an outcome was good', () => {
    render(<CommandOutcomeCard outcome={outcome({ state: 'failed', executed: false })} />);
    const text = screen.getByTestId('command-outcome').textContent ?? '';
    // Facts, not verdicts — the person decides how to feel about it.
    expect(text).not.toMatch(/\b(success|successful|error|oops|sorry|great|nice)\b/i);
  });
});
