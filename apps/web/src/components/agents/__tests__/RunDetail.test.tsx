/**
 * Run detail — the "run again" affordance.
 *
 * The honesty rules under test: a rerun is a NEW run on the CURRENT
 * version of the agent's lineage (never a silent replay of the pinned
 * historical version), the version difference is said before the click,
 * and the offer disappears entirely when the agent no longer exists or
 * the run is still live.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RunDetail } from '../RunDetail';
import * as agentsApi from '@/lib/api/agents';
import type { AgentRun } from '@/lib/api/agents';

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return {
    ...actual,
    useAgents: vi.fn(),
    useApproveStep: vi.fn(),
    useRejectStep: vi.fn(),
    useCancelRun: vi.fn(),
    useStartRun: vi.fn(),
  };
});

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent_v3',
    workspaceId: 'ws_1',
    lineageId: 'lin_1',
    name: 'Researcher',
    instructions: 'Research carefully.',
    allowedTools: [],
    approvalPolicy: 'always' as const,
    limits: { maxSteps: 10, maxToolCalls: 10, maxDurationMs: 300000 },
    version: 3,
    createdBy: 'u1',
    createdAt: 1,
    archived: false,
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run_1',
    agentId: 'agent_v2',
    agentVersion: 2,
    lineageId: 'lin_1',
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'Summarise the market',
    state: 'failed',
    steps: [],
    toolCallsUsed: 0,
    log: [],
    createdAt: Date.now(),
    ...overrides,
  } as AgentRun;
}

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderDetail(theRun: AgentRun) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RunDetail workspaceId="ws_1" run={theRun} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(agentsApi.useAgents).mockReturnValue({ data: [agent()], isLoading: false } as never);
  vi.mocked(agentsApi.useApproveStep).mockReturnValue(idle() as never);
  vi.mocked(agentsApi.useRejectStep).mockReturnValue(idle() as never);
  vi.mocked(agentsApi.useCancelRun).mockReturnValue(idle() as never);
  vi.mocked(agentsApi.useStartRun).mockReturnValue(idle() as never);
});

describe('RunDetail — run again', () => {
  it('starts a NEW run on the current version of the lineage, not the pinned one', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    vi.mocked(agentsApi.useStartRun).mockReturnValue(idle({ mutate: start }) as never);

    renderDetail(run());
    await user.click(screen.getByRole('button', { name: /run again/i }));

    // The run executed agent_v2; the lineage's current version is
    // agent_v3. Replaying v2 silently would run rules the person has
    // since edited away.
    expect(start).toHaveBeenCalledWith(
      { agentId: 'agent_v3', task: 'Summarise the market', projectId: undefined },
      expect.anything(),
    );
  });

  it('carries the original run\'s project filing over to the rerun', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    vi.mocked(agentsApi.useStartRun).mockReturnValue(idle({ mutate: start }) as never);

    renderDetail(run({ projectId: 'proj_9' }));
    await user.click(screen.getByRole('button', { name: /run again/i }));

    // A rerun of project work is still that project's work — staying
    // filed is the default a person would expect without redoing it.
    expect(start).toHaveBeenCalledWith(
      { agentId: 'agent_v3', task: 'Summarise the market', projectId: 'proj_9' },
      expect.anything(),
    );
  });

  it('says before the click that the agent has changed since this run', () => {
    renderDetail(run());
    expect(
      screen.getByText(/edited since this run.*current version.*v3.*this run executed v2/i),
    ).toBeInTheDocument();
  });

  it('adds no version note when the run already used the current version', () => {
    vi.mocked(agentsApi.useAgents).mockReturnValue({
      data: [agent({ id: 'agent_v2', version: 2 })],
      isLoading: false,
    } as never);

    renderDetail(run());
    expect(screen.getByRole('button', { name: /run again/i })).toBeInTheDocument();
    // A warning with nothing to warn about teaches people to skip
    // warnings.
    expect(screen.queryByText(/edited since this run/i)).not.toBeInTheDocument();
  });

  it('withdraws the offer when the agent no longer exists', () => {
    vi.mocked(agentsApi.useAgents).mockReturnValue({ data: [], isLoading: false } as never);

    renderDetail(run());
    // Better absent than failing on click against an agent that is gone.
    expect(screen.queryByRole('button', { name: /run again/i })).not.toBeInTheDocument();
  });

  it('never offers a rerun while the run is still live', () => {
    renderDetail(run({ state: 'running' }));
    // Two concurrent copies of the same task by accident is the failure
    // this guards.
    expect(screen.queryByRole('button', { name: /run again/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop this run/i })).toBeInTheDocument();
  });

  it('offers it for completed runs too — redoing work is not only for failures', () => {
    renderDetail(run({ state: 'completed' }));
    expect(screen.getByRole('button', { name: /run again/i })).toBeInTheDocument();
  });
});
