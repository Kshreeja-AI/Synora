/**
 * The run permalink page — the address a project's timeline links an
 * agent or workflow run to, since neither had one before this.
 *
 * The property under test is that the page correctly identifies WHICH kind
 * of thing produced the run (an agent or a workflow both execute through
 * the same run record) without guessing: it tries both lookups and shows
 * whichever one actually resolves, falling back to a neutral label rather
 * than a wrong claim if neither does yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RunDetailPage from './page';
import * as agentsApi from '@/lib/api/agents';
import * as workflowsApi from '@/lib/api/workflows';
import * as projectsApi from '@/lib/api/projects';
import type { Agent, AgentRun } from '@/lib/api/agents';
import type { WorkflowDefinition } from '@/lib/api/workflows';

vi.mock('next/navigation', () => ({
  useParams: () => ({ runId: 'run_1' }),
}));

vi.mock('@/hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({
    currentWorkspace: { id: 'ws_1', name: 'Test Co' },
    isLoading: false,
  }),
}));

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return {
    ...actual,
    useAgentRun: vi.fn(),
    useAgent: vi.fn(),
    useAgents: vi.fn(),
    useApproveStep: vi.fn(),
    useRejectStep: vi.fn(),
    useCancelRun: vi.fn(),
    useStartRun: vi.fn(),
  };
});

vi.mock('@/lib/api/workflows', async () => {
  const actual = await vi.importActual<typeof workflowsApi>('@/lib/api/workflows');
  return { ...actual, useWorkflow: vi.fn() };
});

vi.mock('@/lib/api/projects', () => ({
  getProject: vi.fn(),
}));

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run_1',
    agentId: 'agent_1',
    agentVersion: 1,
    lineageId: 'lin_1',
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'Summarise the competitive landscape',
    state: 'completed',
    steps: [],
    toolCallsUsed: 2,
    log: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

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

const workflow: WorkflowDefinition = {
  id: 'wf_1',
  workspaceId: 'ws_1',
  lineageId: 'wflin_1',
  name: 'Nightly report',
  instructions: '',
  steps: [],
  allowedTools: [],
  approvalPolicy: 'mutations',
  limits: { maxSteps: 20, maxToolCalls: 30, maxDurationMs: 300000, maxRetriesPerStep: 2 },
  version: 1,
  createdBy: 'u1',
  createdAt: Date.now(),
  archived: false,
};

function idleMutation() {
  return { mutate: vi.fn(), isPending: false };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RunDetailPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(agentsApi.useAgents).mockReturnValue({ data: [] } as never);
  vi.mocked(agentsApi.useApproveStep).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useRejectStep).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useCancelRun).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useStartRun).mockReturnValue(idleMutation() as never);
  vi.mocked(agentsApi.useAgent).mockReturnValue({ data: undefined } as never);
  vi.mocked(workflowsApi.useWorkflow).mockReturnValue({ data: undefined } as never);
  vi.mocked(projectsApi.getProject).mockRejectedValue(new Error('not fetched in this test'));
});

describe('RunDetailPage', () => {
  it('names the run by its agent when the run came from an agent', () => {
    vi.mocked(agentsApi.useAgentRun).mockReturnValue({
      data: makeRun(),
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(agentsApi.useAgent).mockReturnValue({ data: agent } as never);

    renderPage();

    expect(screen.getByRole('heading', { name: 'Researcher' })).toBeInTheDocument();
    expect(screen.getByText('Summarise the competitive landscape')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /agents/i })).toHaveAttribute('href', '/agents');
  });

  it('names the run by its workflow when the agent lookup finds nothing', () => {
    vi.mocked(agentsApi.useAgentRun).mockReturnValue({
      data: makeRun({ agentId: 'wf_1', lineageId: 'wflin_1' }),
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(workflowsApi.useWorkflow).mockReturnValue({ data: workflow } as never);

    renderPage();

    expect(screen.getByRole('heading', { name: 'Nightly report' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /workflows/i })).toHaveAttribute(
      'href',
      '/workflows',
    );
  });

  it('falls back to a neutral label rather than a guess while neither lookup has resolved', () => {
    vi.mocked(agentsApi.useAgentRun).mockReturnValue({
      data: makeRun(),
      isLoading: false,
      error: null,
    } as never);

    renderPage();

    expect(screen.getByRole('heading', { name: 'Agent run' })).toBeInTheDocument();
  });

  it('names and links the project a run is filed into', async () => {
    vi.mocked(agentsApi.useAgentRun).mockReturnValue({
      data: makeRun({ projectId: 'proj_9' }),
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(agentsApi.useAgent).mockReturnValue({ data: agent } as never);
    vi.mocked(projectsApi.getProject).mockResolvedValue({
      id: 'proj_9',
      name: 'Q3 Launch',
    } as never);

    renderPage();

    const link = await screen.findByRole('link', { name: /Filed in Q3 Launch/i });
    expect(link).toHaveAttribute('href', '/dashboard/projects/proj_9');
  });

  it('shows no project label for a run that was never filed', () => {
    vi.mocked(agentsApi.useAgentRun).mockReturnValue({
      data: makeRun(),
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(agentsApi.useAgent).mockReturnValue({ data: agent } as never);

    renderPage();

    expect(screen.queryByText(/Filed in/)).not.toBeInTheDocument();
  });

  it('says plainly when the run cannot be found, with a way back', () => {
    vi.mocked(agentsApi.useAgentRun).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Run not found'),
    } as never);

    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Run not found');
    expect(screen.getByRole('link', { name: /back to agents/i })).toHaveAttribute(
      'href',
      '/agents',
    );
  });
});
