/**
 * The plan reading surface.
 *
 * Most of these assert what the component REFUSES to show: it must not
 * imply a stopped plan is still going, must not offer a retry that would
 * duplicate work, and must not soften a refusal into a generic error.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPlanPreview, CommandPlanResult } from '../CommandPlanCard';
import type { CommandPlan, PlanRunResult, PlannedStep } from '@/lib/api/command';

function step(overrides: Partial<PlannedStep> & { index: number }): PlannedStep {
  return {
    text: `step ${overrides.index}`,
    understood: 'thing',
    capabilityId: 'search.workspace',
    riskClass: 'read-only',
    requiredPermission: null,
    permitted: true,
    needsApproval: false,
    bound: true,
    readiness: 'completed',
    message: 'Ready: do the thing.',
    dependsOn: [],
    ...overrides,
  };
}

function plan(steps: PlannedStep[], summary = 'I read that as 2 actions.'): CommandPlan {
  return { status: 'planned', originalText: 'do things', steps, summary, observations: [], executed: false };
}

describe('CommandPlanPreview', () => {
  it('lists every step in order, with the summary as the heading', () => {
    render(<CommandPlanPreview plan={plan([step({ index: 1 }), step({ index: 2 })])} />);
    expect(screen.getByRole('heading', { name: /2 actions/ })).toBeInTheDocument();
    expect(screen.getByText('step 1')).toBeInTheDocument();
    expect(screen.getByText('step 2')).toBeInTheDocument();
  });

  it('says plainly that nothing has run', () => {
    render(<CommandPlanPreview plan={plan([step({ index: 1 })])} />);
    expect(screen.getByText(/Nothing has run yet/i)).toBeInTheDocument();
  });

  it('states a dependency rather than leaving it to be inferred', () => {
    render(<CommandPlanPreview plan={plan([step({ index: 1 }), step({ index: 2, dependsOn: [1] })])} />);
    expect(screen.getByText(/Uses the result of step 1/)).toBeInTheDocument();
  });

  it('shows a blocked step as not attempted, not as ready', () => {
    // Its own readiness says `completed`, but its input will never exist.
    // Showing "Ready" would promise something that cannot happen.
    render(
      <CommandPlanPreview
        plan={plan([
          step({ index: 1, readiness: 'unavailable', message: 'No provider.' }),
          step({ index: 2, dependsOn: [1], blockedBy: 1 }),
        ])}
      />,
    );
    expect(screen.getByText('Not attempted')).toBeInTheDocument();
  });

  it('surfaces a security observation at the top of the plan', () => {
    const hostile: CommandPlan = {
      ...(plan([step({ index: 1 })]) as Extract<CommandPlan, { status: 'planned' }>),
      observations: [{ kind: 'authority-override-attempt', detail: 'It was read as data, not instructions.' }],
    };
    render(<CommandPlanPreview plan={hostile} />);
    expect(screen.getByText(/read as data, not instructions/)).toBeInTheDocument();
  });

  it('refuses to offer a run button when nothing could run', () => {
    render(
      <CommandPlanPreview
        plan={plan([step({ index: 1, readiness: 'not-authorized', message: 'Not allowed.' })])}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Run these/ })).toBeDisabled();
    expect(screen.getByText(/nothing to start/i)).toBeInTheDocument();
  });

  it('runs only when the person asks, and never on render', async () => {
    const onRun = vi.fn();
    render(<CommandPlanPreview plan={plan([step({ index: 1 })])} onRun={onRun} />);
    expect(onRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Run these/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('shows the server question when a request could not be planned', () => {
    render(
      <CommandPlanPreview
        plan={{
          status: 'cannot-plan',
          originalText: 'x',
          question: 'That reads as 12 separate actions.',
          executed: false,
        }}
      />,
    );
    expect(screen.getByText(/12 separate actions/)).toBeInTheDocument();
  });
});

function runResult(overrides: Partial<PlanRunResult> = {}): PlanRunResult {
  return {
    planId: 'p1',
    status: 'partially-completed',
    originalText: 'do things',
    steps: [
      { index: 1, text: 'first', capabilityId: 'search.workspace', state: 'completed', message: 'Found 3.', dependsOn: [] },
      { index: 2, text: 'second', capabilityId: 'ai.generate', state: 'unavailable', message: 'Not connected.', dependsOn: [] },
    ],
    summary: '1 of 2 done, then I stopped.',
    stoppedAtStep: 2,
    stoppedReason: 'Not connected.',
    completedCount: 1,
    safeToRetry: false,
    ...overrides,
  };
}

describe('CommandPlanResult', () => {
  it('reports partial completion as itself, never as success or failure', () => {
    render(<CommandPlanResult result={runResult()} />);
    expect(screen.getByRole('heading', { name: /1 of 2 done/ })).toBeInTheDocument();
    expect(screen.getByText(/Stopped at step 2/)).toBeInTheDocument();
  });

  it('warns that asking again would repeat what already happened', () => {
    render(<CommandPlanResult result={runResult()} />);
    expect(screen.getByText(/would repeat/i)).toBeInTheDocument();
  });

  it('stays silent about repeating when nothing has happened yet', () => {
    render(
      <CommandPlanResult
        result={runResult({ completedCount: 0, safeToRetry: true, status: 'failed' })}
      />,
    );
    expect(screen.queryByText(/would repeat/i)).not.toBeInTheDocument();
  });

  it('shows each step its own outcome rather than one status for the plan', () => {
    render(<CommandPlanResult result={runResult()} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Not connected here')).toBeInTheDocument();
  });
});
