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

  describe('drafted revisions', () => {
    const measuredDraft = {
      text: 'You are a summariser. Answer with a one-line summary.',
      summary: 'The draft scored better on the captured failures (mean score +0.40; 2 case(s) better, 0 worse, 0 unchanged).',
      unavailable: [],
      verdict: 'improvement' as const,
      meanScoreDelta: 0.4,
      passRateDelta: 0.5,
    };

    it('shows the draft text with its measured verdict', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([{ ...proposal, draft: measuredDraft }]);
      renderPanel();

      expect(await screen.findByText(/You are a summariser/)).toBeInTheDocument();
      expect(screen.getByText('measured: improvement')).toBeInTheDocument();
      expect(screen.getByText('mean score +0.40')).toBeInTheDocument();
      expect(screen.getByText('pass rate +50%')).toBeInTheDocument();
    });

    it('gives the verdict the same weight as the draft heading, not a footnote', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([{ ...proposal, draft: measuredDraft }]);
      renderPanel();

      const verdict = await screen.findByText('measured: improvement');
      const heading = screen.getByText('Drafted revision');

      // A revision shown prominently with a small assessment beside it
      // invites the reader to take the text and skip the judgement.
      expect(verdict.className).toContain('text-sm');
      expect(verdict.className).toContain('font-semibold');
      expect(heading.className).toContain('text-sm');
    });

    it('marks a draft that was never run as unproven', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([
        {
          ...proposal,
          draft: {
            text: 'a candidate prompt',
            summary: 'A draft was written but never run, so there is no evidence it is better.',
            unavailable: ['No candidate executor, so the draft could not be run.'],
          },
        },
      ]);
      renderPanel();

      expect(await screen.findByText('not measured — unproven')).toBeInTheDocument();
      expect(screen.getByText(/No candidate executor/)).toBeInTheDocument();
      // It must not borrow the credibility of a measured result.
      expect(screen.queryByText(/measured: /)).not.toBeInTheDocument();
    });

    it('shows a draft that scored worse rather than hiding it', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([
        {
          ...proposal,
          draft: {
            ...measuredDraft,
            verdict: 'regression' as const,
            meanScoreDelta: -0.3,
            summary: 'The draft scored worse than the prompt in use.',
          },
        },
      ]);
      renderPanel();

      expect(await screen.findByText('measured: regression')).toBeInTheDocument();
      expect(screen.getByText('mean score -0.30')).toBeInTheDocument();
    });

    it('does not present a mixed result as a win', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([
        {
          ...proposal,
          draft: { ...measuredDraft, verdict: 'mixed' as const, summary: 'This is not a clear win.' },
        },
      ]);
      renderPanel();

      expect(await screen.findByText('measured: mixed')).toBeInTheDocument();
      expect(screen.getByText(/not a clear win/i)).toBeInTheDocument();
    });

    it('explains why a draft is absent instead of showing nothing', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([
        {
          ...proposal,
          draft: {
            text: null,
            summary: 'No draft was produced. This is a missing capability, not a judgement.',
            unavailable: ['No drafter is configured, so no candidate prompt was written.'],
          },
        },
      ]);
      renderPanel();

      expect(await screen.findByText(/missing capability, not a judgement/i)).toBeInTheDocument();
      expect(screen.getByText(/No drafter is configured/)).toBeInTheDocument();
    });

    it('shows no draft section at all when a proposal has none', async () => {
      renderPanel();

      await screen.findByText(proposal.title);
      expect(screen.queryByText('Drafted revision')).not.toBeInTheDocument();
    });

    it('still requires a decision when the draft improved', async () => {
      vi.mocked(eosApi.getProposals).mockResolvedValue([{ ...proposal, draft: measuredDraft }]);
      renderPanel();

      // A good score is evidence, not approval. The buttons stay.
      expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(screen.getByText(/Nothing is applied automatically/i)).toBeInTheDocument();
    });
  });

  it('renders without crashing when the endpoint fails', async () => {
    vi.mocked(eosApi.getProposals).mockRejectedValue(new Error('down'));
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Proposals/i })).toBeInTheDocument();
    });
  });
});
