/**
 * The one panel on the home page that claims attention.
 *
 * The assertions here are mostly about what it refuses to do. A dashboard
 * that ranks, scores or nudges is inventing urgency about someone's own
 * work; this shows only what is literally stopped and waiting for a
 * decision, and says nothing when nothing is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WaitingForYou } from '../WaitingForYou';
import * as agentsApi from '@/lib/api/agents';

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return { ...actual, useAgentRuns: vi.fn() };
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    agentId: 'a1',
    agentVersion: 1,
    lineageId: 'l1',
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'Email the supplier about the delay',
    state: 'awaiting_approval',
    steps: [],
    pendingApproval: { stepId: 's2', reason: 'sends an email on your behalf' },
    toolCallsUsed: 0,
    log: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WaitingForYou workspaceId="ws_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
    data: [run()],
    isLoading: false,
  } as never);
});

describe('WaitingForYou', () => {
  it('shows a run that is genuinely stopped, with the reason it asked', () => {
    renderPanel();
    expect(screen.getByText('Email the supplier about the delay')).toBeInTheDocument();
    expect(screen.getByText(/sends an email on your behalf/)).toBeInTheDocument();
  });

  it('shows only runs that are actually blocked on a person', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [
        run({ id: 'r_running', state: 'running', task: 'Still working' }),
        run({ id: 'r_done', state: 'completed', task: 'Finished last week' }),
        run({ id: 'r_failed', state: 'failed', task: 'Broke yesterday' }),
      ],
      isLoading: false,
    } as never);

    renderPanel();
    // A finished or failed run is not waiting for a decision. Listing it
    // here would turn the panel into a feed, which is exactly the thing
    // that makes people stop reading it.
    expect(screen.getByText(/Nothing is paused for a decision/)).toBeInTheDocument();
    expect(screen.queryByText('Still working')).not.toBeInTheDocument();
    expect(screen.queryByText('Broke yesterday')).not.toBeInTheDocument();
  });

  it('says nothing is waiting, without congratulating anybody', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: [], isLoading: false } as never);

    renderPanel();
    expect(screen.getByText(/Nothing is paused for a decision/)).toBeInTheDocument();
    // "You're all caught up!" treats an empty queue as an achievement,
    // which quietly implies the queue is the thing to be emptied.
    expect(screen.queryByText(/caught up|all done|great job|nice work/i)).not.toBeInTheDocument();
  });

  it('explains that a paused run stays paused, so waiting is not a leak', () => {
    renderPanel();
    // The important reassurance: nothing is quietly running while it
    // waits for an answer.
    expect(screen.getByText(/Nothing runs in the meantime/)).toBeInTheDocument();
  });

  it('renders nothing while runs are still loading', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    const { container } = renderPanel();
    // Better absent than a skeleton implying something is waiting when
    // the answer may be that nothing is.
    expect(container).toBeEmptyDOMElement();
  });
});
