/**
 * Proposals panel tests.
 *
 * The property under test is the same one the engine was built around:
 * a proposal is a suggestion backed by evidence with stated limits, and
 * approving it executes nothing. Presentation can destroy both properties
 * without changing a line of backend code — caveats rendered as a footnote
 * get skipped, and a button labelled "Apply" implies an action that does
 * not exist. These tests hold the presentation to the same contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProposalsPanel } from '../ProposalsPanel';
import * as eosApi from '@/lib/api/eos';
import type { Proposal } from '@/lib/api/eos';

vi.mock('@/lib/api/eos');

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProposalsPanel />
    </QueryClientProvider>
  );
}

const proposal: Proposal = {
  id: 'prop_1',
  createdAt: Date.now(),
  trigger: 'prompt-regression',
  title: 'Prompt "chat.generate" v1 is regressing',
  problem:
    'Recent success rate fell to 30% against a historical 90%, a drop of 60 percentage points over the last 10 executions.',
  suggestedAction:
    'Review the captured failing cases, then evaluate a revised prompt against them before changing anything in production.',
  caveats: [
    'Correlation, not diagnosis: a success-rate drop does not identify the cause.',
    'The prompt may be fine and the provider may have changed underneath it.',
  ],
  evidence: {
    summary: 'Prompt regression detected on chat.generate v1.',
    metrics: { overallSuccessRate: '90%', recentSuccessRate: '30%', dropPercentagePoints: 60 },
    affectedCaseIds: ['case_a', 'case_b'],
  },
  status: 'pending',
};

beforeEach(() => {
  vi.mocked(eosApi.getProposals).mockResolvedValue([proposal]);
  vi.mocked(eosApi.decideProposal).mockResolvedValue({ ...proposal, status: 'approved' });
});

describe('ProposalsPanel', () => {
  it('states that the platform cannot act on its own proposals', async () => {
    renderPanel();
    expect(await screen.findByText(/It cannot act on any of it/i)).toBeInTheDocument();
  });

  it('explains an empty list rather than showing a blank panel', async () => {
    vi.mocked(eosApi.getProposals).mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/nothing has met that bar yet/i)).toBeInTheDocument();
  });

  it('shows the problem with the numbers behind it', async () => {
    renderPanel();
    expect(await screen.findByText(/drop of 60 percentage points/i)).toBeInTheDocument();
    expect(screen.getByText('dropPercentagePoints')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });

  it('renders every caveat, under a heading that frames them as limits', async () => {
    renderPanel();

    expect(await screen.findByText(/What this evidence cannot tell you/i)).toBeInTheDocument();
    for (const caveat of proposal.caveats) {
      expect(screen.getByText(caveat)).toBeInTheDocument();
    }
  });

  it('gives the caveats the same text size as the finding, not a footnote', async () => {
    renderPanel();

    const caveat = await screen.findByText(proposal.caveats[0]);
    const problem = screen.getByText(/drop of 60 percentage points/i);

    // `text-xs` here would make the limits skippable, which is exactly how
    // an honest proposal turns into a misread instruction.
    const caveatList = caveat.closest('ul')!;
    expect(caveatList.className).toContain('text-sm');
    expect(caveatList.className).not.toContain('text-xs');
    expect(problem.className).toContain('text-sm');
  });

  it('lists the captured failing cases so they can be inspected', async () => {
    renderPanel();
    expect(await screen.findByText(/2 captured failing case/i)).toBeInTheDocument();
    expect(screen.getByText(/case_a, case_b/)).toBeInTheDocument();
  });

  it('says so plainly when no cases were captured', async () => {
    vi.mocked(eosApi.getProposals).mockResolvedValue([
      { ...proposal, evidence: { ...proposal.evidence, affectedCaseIds: [] } },
    ]);
    renderPanel();
    expect(await screen.findByText(/No captured cases are attached/i)).toBeInTheDocument();
  });

  it('offers approve and reject, and never a control that implies execution', async () => {
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    // No "Apply", "Run", or "Deploy" — the backend has no such capability,
    // and a button offering it would be a lie about what approval does.
    expect(screen.queryByRole('button', { name: /apply|run|deploy|execute/i })).toBeNull();
    expect(screen.getByText(/Nothing is applied automatically/i)).toBeInTheDocument();
  });

  it('sends an approval with the note the founder typed', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/Optional note/i), 'agreed');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(eosApi.decideProposal).toHaveBeenCalledWith('prop_1', 'approved', 'agreed');
    });
  });

  it('sends no note when the field is left empty', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));

    await waitFor(() => {
      // undefined rather than '' — an empty string would be recorded as a
      // note the founder never wrote.
      expect(eosApi.decideProposal).toHaveBeenCalledWith('prop_1', 'rejected', undefined);
    });
  });

  it('shows a decided proposal as a record, with no decision controls', async () => {
    vi.mocked(eosApi.getProposals).mockResolvedValue([
      { ...proposal, status: 'approved', decidedAt: Date.now(), decisionNote: 'agreed' },
    ]);
    renderPanel();

    expect(await screen.findByText(/1 already decided/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('surfaces a failed decision instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    vi.mocked(eosApi.decideProposal).mockRejectedValue(new Error('backend unreachable'));
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/backend unreachable/i)).toBeInTheDocument();
  });

  it('renders without crashing when the endpoint fails', async () => {
    vi.mocked(eosApi.getProposals).mockRejectedValue(new Error('down'));
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Proposals/i })).toBeInTheDocument();
    });
  });
});
