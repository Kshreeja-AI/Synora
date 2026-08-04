/**
 * Agent workspace tests.
 *
 * The property under test is honesty about what an agent actually did and
 * what produced it. A page that renders a deterministic local plan
 * indistinguishably from a model-produced one would be the UI committing
 * the fabrication the backend refuses to, so the LOCAL/REAL label is
 * asserted rather than assumed. The other assertions cover the boundaries a
 * person relies on: fail-closed defaults are shown truthfully, a refused
 * run explains itself, and rejecting a step is not presented as skipping it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentsPage from '../page';
import * as agentsApi from '@/lib/api/agents';
import type { Agent, AgentRun, RunWithRuntime } from '@/lib/api/agents';

vi.mock('@/hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({ currentWorkspace: { id: 'ws_1', name: 'Test Co' } }),
}));

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return {
    ...actual,
    useAgents: vi.fn(),
    useAgentRuns: vi.fn(),
    useStartRun: vi.fn(),
    useArchiveAgent: vi.fn(),
    useApproveStep: vi.fn(),
    useRejectStep: vi.fn(),
    useCancelRun: vi.fn(),
  };
});

const agent: Agent = {
  id: 'agent_1',
  workspaceId: 'ws_1',
  lineageId: 'lin_1',
  name: 'Researcher',
  instructions: 'be brief',
  allowedTools: [],
  approvalPolicy: 'mutations',
  limits: { maxSteps: 20, maxToolCalls: 30, maxDurationMs: 300000, maxRetriesPerStep: 2 },
  version: 1,
  createdBy: 'u1',
  createdAt: Date.now(),
  archived: false,
};

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run_1',
    agentId: agent.id,
    agentVersion: 1,
    lineageId: agent.lineageId,
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'summarise the report',
    state: 'completed',
    steps: [],
    toolCallsUsed: 0,
    log: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function idleMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(agentsApi.useAgents).mockReturnValue({
    data: [agent],
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: [] } as never);
  vi.mocked(agentsApi.useStartRun).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useArchiveAgent).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useApproveStep).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useRejectStep).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useCancelRun).mockReturnValue(idleMutation() as never);
});

describe('agents page', () => {
  it('describes an agent by what it may do, not just its name', async () => {
    renderPage();

    expect(await screen.findByText('Researcher')).toBeInTheDocument();
    // Fail-closed defaults must be visible as they actually are. Showing
    // "no tools" is the difference between a user knowing the agent is
    // inert and assuming it can act.
    expect(screen.getByText(/no tools/)).toBeInTheDocument();
    expect(screen.getByText(/asks before changes/)).toBeInTheDocument();
  });

  it('labels a locally-planned run as LOCAL and says it is not intelligence', async () => {
    const user = userEvent.setup();
    const result: RunWithRuntime = {
      run: makeRun(),
      runtime: {
        mode: 'local',
        notice:
          'LOCAL: no AI provider is configured, so this run was planned by a deterministic local planner that follows a fixed grammar. It demonstrates orchestration — permissions, approvals, limits, history — not model intelligence.',
        planOrigin: 'local-deterministic',
      },
    };
    vi.mocked(agentsApi.useStartRun).mockReturnValue(
      idleMutation({
        mutate: vi.fn((_vars, opts) => opts?.onSuccess?.(result)),
      }) as never,
    );

    renderPage();
    await user.click(await screen.findByText('Researcher'));
    await user.type(screen.getByLabelText(/give it a task/i), 'do a thing');
    await user.click(screen.getByRole('button', { name: /^run$/i }));

    // This is the assertion that matters most on this page.
    expect(await screen.findByText(/LOCAL — deterministic, not AI/)).toBeInTheDocument();
    expect(screen.getByText(/not model intelligence/)).toBeInTheDocument();
  });

  it('labels a model-planned run as REAL and names the provider', async () => {
    const user = userEvent.setup();
    const result: RunWithRuntime = {
      run: makeRun(),
      runtime: {
        mode: 'model',
        provider: 'anthropic',
        notice: 'REAL: this run was planned by a configured AI provider.',
        planOrigin: 'model',
      },
    };
    vi.mocked(agentsApi.useStartRun).mockReturnValue(
      idleMutation({
        mutate: vi.fn((_vars, opts) => opts?.onSuccess?.(result)),
      }) as never,
    );

    renderPage();
    await user.click(await screen.findByText('Researcher'));
    await user.type(screen.getByLabelText(/give it a task/i), 'do a thing');
    await user.click(screen.getByRole('button', { name: /^run$/i }));

    expect(await screen.findByText(/REAL — planned by anthropic/)).toBeInTheDocument();
  });

  it('explains a refused run rather than showing an empty step list', async () => {
    const user = userEvent.setup();
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [
        makeRun({
          state: 'failed',
          error: 'step s1 uses tool "exfil", which this agent is not permitted to call',
          steps: [],
        }),
      ],
    } as never);

    renderPage();
    await user.click(await screen.findByText('Researcher'));
    await user.click(await screen.findByRole('button', { name: /summarise the report/i }));

    expect(await screen.findByText(/not permitted to call/)).toBeInTheDocument();
    // An empty list with no explanation would read as "nothing happened"
    // rather than "this was refused".
    expect(screen.getByText(/refused whole rather than run in part/)).toBeInTheDocument();
  });

  it('warns that rejecting a step ends the run instead of skipping it', async () => {
    const user = userEvent.setup();
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [
        makeRun({
          state: 'awaiting_approval',
          pendingApproval: { stepId: 's1', reason: 'this step changes something' },
          steps: [
            {
              step: { id: 's1', kind: 'tool', description: 'call writer', toolId: 'writer', input: 'x' },
              state: 'awaiting_approval',
              attempts: 0,
            },
          ],
        }),
      ],
    } as never);

    renderPage();
    await user.click(await screen.findByText('Researcher'));
    await user.click(await screen.findByRole('button', { name: /summarise the report/i }));

    expect(await screen.findByText(/Waiting for your decision on step s1/)).toBeInTheDocument();
    expect(screen.getByText(/Rejecting ends the whole run/)).toBeInTheDocument();
    // Undeclared mutability is shown as mutating, matching the engine.
    expect(screen.getByText(/treated as mutating/)).toBeInTheDocument();
  });

  it('offers to stop a run that has not reached a terminal state', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    vi.mocked(agentsApi.useCancelRun).mockReturnValue(idleMutation({ mutate: cancel }) as never);
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [makeRun({ state: 'awaiting_approval', pendingApproval: { stepId: 's1', reason: 'r' } })],
    } as never);

    renderPage();
    await user.click(await screen.findByText('Researcher'));
    await user.click(await screen.findByRole('button', { name: /summarise the report/i }));
    await user.click(await screen.findByRole('button', { name: /stop this run/i }));

    expect(cancel).toHaveBeenCalled();
  });

  it('does not offer to stop a run that has already finished', async () => {
    const user = userEvent.setup();
    vi.mocked(agentsApi.useAgentRuns).mockReturnValue({
      data: [makeRun({ state: 'completed' })],
    } as never);

    renderPage();
    await user.click(await screen.findByText('Researcher'));
    await user.click(await screen.findByRole('button', { name: /summarise the report/i }));

    await waitFor(() => expect(screen.getByText('Task')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /stop this run/i })).not.toBeInTheDocument();
  });

  it('shows an empty state before any agent exists', async () => {
    vi.mocked(agentsApi.useAgents).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never);

    renderPage();
    expect(await screen.findByText('No agents yet')).toBeInTheDocument();
  });
});
