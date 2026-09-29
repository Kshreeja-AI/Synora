/**
 * "Needs attention" — runs that stopped on their own, distinct from
 * "Waiting for you" (stopped ON PURPOSE, pending a person's decision).
 *
 * The property under test that matters most: no fabricated recommendation
 * ever appears. Only the real, recorded facts are shown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NeedsAttention } from '../NeedsAttention';
import * as agentsApi from '@/lib/api/agents';

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return { ...actual, useAgentRuns: vi.fn(), useAgents: vi.fn() };
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    agentId: 'a1',
    agentVersion: 1,
    lineageId: 'l1',
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'Sync the inventory sheet',
    state: 'failed',
    steps: [],
    toolCallsUsed: 0,
    log: [],
    error: 'the spreadsheet tool returned a 500',
    createdAt: Date.now() - 60_000,
    finishedAt: Date.now(),
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NeedsAttention workspaceId="ws_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: [run()], isLoading: false } as never);
  vi.mocked(agentsApi.useAgents).mockReturnValue({
    data: [{ id: 'a1', lineageId: 'l1', name: 'Inventory bot' }],
  } as never);
});

describe('NeedsAttention', () => {
  it('shows a failed run with its real recorded error, not an invented explanation', () => {
    renderPanel();
    expect(screen.getByText('Sync the inventory sheet')).toBeInTheDocument();
    expect(screen.getByText('the spreadsheet tool returned a 500')).toBeInTheDocument();
    expect(screen.getByText(/Inventory bot/)).toBeInTheDocument();
  });

  it('never shows a fabricated recommendation for what to do', () => {
    renderPanel();
    // Synora has no system that judges why a run failed. Inventing one
    // here would be exactly the fake AI confidence this platform refuses
    // to show anywhere else.
    expect(
      screen.queryByText(/recommend|you should|try again with|likely caused by/i),
    ).not.toBeInTheDocument();
  });

  it('shows only failed and timed-out runs', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [
        run({ id: 'r_timeout', state: 'timed_out', task: 'Ran out of time', error: undefined }),
        run({ id: 'r_running', state: 'running', task: 'Still going' }),
        run({ id: 'r_done', state: 'completed', task: 'Went fine' }),
        run({ id: 'r_waiting', state: 'awaiting_approval', task: 'Paused for a decision' }),
      ],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText('Ran out of time')).toBeInTheDocument();
    expect(screen.getByText(/ran out of time/)).toBeInTheDocument();
    expect(screen.queryByText('Still going')).not.toBeInTheDocument();
    expect(screen.queryByText('Went fine')).not.toBeInTheDocument();
    // Paused-for-approval belongs to "Waiting for you" — it did not stop
    // on its own, it was designed to stop right there.
    expect(screen.queryByText('Paused for a decision')).not.toBeInTheDocument();
  });

  it('renders nothing when nothing has failed — no empty warning section', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: [], isLoading: false } as never);

    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while runs are still loading', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: undefined, isLoading: true } as never);

    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });
});
