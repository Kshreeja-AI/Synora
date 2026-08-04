/**
 * "Working right now" — the ACTIVE half of the home page's decision
 * center. Shows only genuinely in-flight runs, offers Stop (the one real
 * action available on something still running), and disappears when
 * there is nothing in flight rather than showing an empty section.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActiveWork } from '../ActiveWork';
import * as agentsApi from '@/lib/api/agents';

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return { ...actual, useAgentRuns: vi.fn(), useAgents: vi.fn(), useCancelRun: vi.fn() };
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    agentId: 'a1',
    agentVersion: 1,
    lineageId: 'l1',
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'Draft the quarterly summary',
    state: 'running',
    steps: [],
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
      <ActiveWork workspaceId="ws_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: [run()], isLoading: false } as never);
  vi.mocked(agentsApi.useAgents).mockReturnValue({
    data: [{ id: 'a1', lineageId: 'l1', name: 'Researcher' }],
  } as never);
  vi.mocked(agentsApi.useCancelRun).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
});

describe('ActiveWork', () => {
  it('shows a run genuinely in progress, with the agent that is doing it', () => {
    renderPanel();
    expect(screen.getByText('Draft the quarterly summary')).toBeInTheDocument();
    expect(screen.getByText(/Researcher/)).toBeInTheDocument();
  });

  it('shows only planning and running states', () => {
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [
        run({ id: 'r_plan', state: 'planning', task: 'Still planning' }),
        run({ id: 'r_wait', state: 'awaiting_approval', task: 'Paused for a decision' }),
        run({ id: 'r_done', state: 'completed', task: 'Already finished' }),
        run({ id: 'r_fail', state: 'failed', task: 'Already broke' }),
      ],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText('Still planning')).toBeInTheDocument();
    // A paused-for-approval run belongs to "Waiting for you", not here —
    // it is not doing anything at this instant.
    expect(screen.queryByText('Paused for a decision')).not.toBeInTheDocument();
    expect(screen.queryByText('Already finished')).not.toBeInTheDocument();
    expect(screen.queryByText('Already broke')).not.toBeInTheDocument();
  });

  it('stops a run on request', () => {
    const mutate = vi.fn();
    vi.mocked(agentsApi.useCancelRun).mockReturnValue({ mutate, isPending: false } as never);

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));

    expect(mutate).toHaveBeenCalledWith('run_1', expect.anything());
  });

  it('renders nothing when nothing is running — no empty section', () => {
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
