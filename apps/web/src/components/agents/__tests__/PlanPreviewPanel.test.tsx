/**
 * The preview panel's job is fidelity: render the report's facts without
 * softening them. The assertions here are the honesty properties — the
 * "nothing has run" framing, the provenance label, blockers stated as
 * failure, pause markers, and caveats rendered in full.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPreviewPanel } from '../PlanPreviewPanel';
import type { PlanPreviewReport } from '@/lib/api/agents';

function report(overrides: Partial<PlanPreviewReport> = {}): PlanPreviewReport {
  return {
    agentId: 'a1',
    agentName: 'Researcher',
    agentVersion: 1,
    task: 'summarize the quarter',
    executed: false,
    planOrigin: 'local-deterministic',
    wouldStart: true,
    blockers: [],
    steps: [
      {
        stepId: 's1',
        kind: 'generate',
        description: 'Draft the summary',
        pausesForApproval: false,
        treatedAsMutating: false,
        unresolvedReferences: [],
        problems: [],
        unknowns: ['the generated text is only knowable by running the step'],
      },
      {
        stepId: 's2',
        kind: 'tool',
        toolId: 'send-email',
        description: 'Send it to the team',
        pausesForApproval: true,
        treatedAsMutating: true,
        unresolvedReferences: [],
        problems: [],
        unknowns: [],
      },
    ],
    projected: {
      steps: 2,
      toolCalls: 1,
      approvalPauses: 1,
      maxSteps: 10,
      maxToolCalls: 5,
      maxDurationMs: 60000,
    },
    caveats: [
      'Nothing was executed: no step ran and no run record exists.',
      'Producing this preview consumed one planning call.',
    ],
    runtime: {
      mode: 'local',
      notice: 'LOCAL: no AI provider is configured, so this run was planned deterministically.',
    },
    ...overrides,
  };
}

describe('PlanPreviewPanel', () => {
  it('says plainly that nothing has run, and where the plan came from', () => {
    render(<PlanPreviewPanel report={report()} />);
    expect(screen.getByText(/Plan preview — nothing has run/)).toBeInTheDocument();
    // The exact provenance component every run uses — a previewed local
    // plan must never look more real than an executed one.
    expect(screen.getByRole('note', { name: /Local deterministic run/ })).toBeInTheDocument();
    expect(screen.getByText(/no run record exists/)).toBeInTheDocument();
  });

  it('marks the steps that will stop and wait for a person', () => {
    render(<PlanPreviewPanel report={report()} />);
    expect(
      screen.getByText(/Pauses here and waits for your approval before running/),
    ).toBeInTheDocument();
    expect(screen.getByText(/may change things outside the run/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown until it runs:/)).toBeInTheDocument();
  });

  it('states blockers as failure, not as advice', () => {
    render(
      <PlanPreviewPanel
        report={report({
          wouldStart: false,
          blockers: ['tool "send-email" does not exist in this workspace'],
        })}
      />,
    );
    expect(screen.getByText(/This run would not succeed as-is/)).toBeInTheDocument();
    expect(
      screen.getByText(/tool "send-email" does not exist in this workspace/),
    ).toBeInTheDocument();
  });
});
