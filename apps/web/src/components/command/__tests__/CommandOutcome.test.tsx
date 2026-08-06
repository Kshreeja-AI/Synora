/**
 * The outcome card.
 *
 * The property under test that matters most: the nine server states are
 * never collapsed. The backend went to real trouble keeping "not connected",
 * "not allowed", "nobody wired it up", "a person must approve" and "it
 * broke" apart; a UI with a tick and a cross would throw that away at the
 * very last step and put the person back to guessing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  describe('undo', () => {
    it('offers undo only when the SERVER said this can be undone', async () => {
      const onUndo = vi.fn();
      const { unmount } = render(
        <CommandOutcomeCard outcome={outcome({ undoable: true })} onUndo={onUndo} />,
      );
      expect(screen.getByRole('button', { name: /undo this/i })).toBeInTheDocument();
      expect(onUndo).not.toHaveBeenCalled();
      unmount();

      // A completed action with no undo target. Offering the button here
      // on the strength of "it ran" would promise a reversal that does not
      // exist, and the person finds out by pressing it.
      render(<CommandOutcomeCard outcome={outcome()} onUndo={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /undo this/i })).not.toBeInTheDocument();
    });

    it('never shows undo on a surface that cannot perform it', () => {
      // No handler means this card is being read, not acted on. A button
      // that did nothing would be worse than no button.
      render(<CommandOutcomeCard outcome={outcome({ undoable: true })} />);
      expect(screen.queryByRole('button', { name: /undo this/i })).not.toBeInTheDocument();
    });

    it('undoes only when asked, exactly once', async () => {
      const onUndo = vi.fn();
      render(<CommandOutcomeCard outcome={outcome({ undoable: true })} onUndo={onUndo} />);
      await userEvent.click(screen.getByRole('button', { name: /undo this/i }));
      expect(onUndo).toHaveBeenCalledTimes(1);
      // Gone after one press. Undo is a one-time thing and the server
      // refuses a second attempt, so leaving the button would invite a
      // press whose only possible outcome is a refusal.
      expect(screen.queryByRole('button', { name: /undo this/i })).not.toBeInTheDocument();
    });

    it('reports the outcome in the server own words, not its own', () => {
      render(
        <CommandOutcomeCard
          outcome={outcome({ undoable: true })}
          onUndo={vi.fn()}
          undoResult={{
            executionId: 'exec_1',
            undone: false,
            reason: 'already-undone',
            message: 'This was already undone, so nothing was done again.',
          }}
        />,
      );
      expect(screen.getByTestId('command-undo-result')).toHaveTextContent(
        /already undone, so nothing was done again/i,
      );
      // A client-side "Undone!" would be the UI asserting something it did
      // not verify — and here it would be asserting the opposite of true.
      expect(screen.getByTestId('command-outcome').textContent).not.toMatch(/^Undone/m);
    });
  });

  it('states no verdict about whether an outcome was good', () => {
    render(<CommandOutcomeCard outcome={outcome({ state: 'failed', executed: false })} />);
    const text = screen.getByTestId('command-outcome').textContent ?? '';
    // Facts, not verdicts — the person decides how to feel about it.
    expect(text).not.toMatch(/\b(success|successful|error|oops|sorry|great|nice)\b/i);
  });
});
