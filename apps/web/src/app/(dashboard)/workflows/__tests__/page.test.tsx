/**
 * Workflow workspace tests.
 *
 * The property under test is that the page teaches the right mental model.
 * A workflow's whole value is that it does the same thing every time, so
 * the UI must not imply the note field steers it, must show the authored
 * label rather than borrowing the agent page's LOCAL/REAL wording, and must
 * surface the server's save-time refusal verbatim — "invalid workflow"
 * would hide which step is actually wrong.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkflowsPage from '../page';
import * as workflowsApi from '@/lib/api/workflows';
import * as agentsApi from '@/lib/api/agents';
import type { WorkflowDefinition, WorkflowRunResult } from '@/lib/api/workflows';
import type { AgentRun } from '@/lib/api/agents';

vi.mock('@/hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({ currentWorkspace: { id: 'ws_1', name: 'Test Co' } }),
}));

vi.mock('@/lib/api/workflows', async () => {
  const actual = await vi.importActual<typeof workflowsApi>('@/lib/api/workflows');
  return {
    ...actual,
    useWorkflows: vi.fn(),
    useCreateWorkflow: vi.fn(),
    useArchiveWorkflow: vi.fn(),
    useStartWorkflowRun: vi.fn(),
  };
});

vi.mock('@/lib/api/agents', async () => {
  const actual = await vi.importActual<typeof agentsApi>('@/lib/api/agents');
  return {
    ...actual,
    useAgentRuns: vi.fn(),
    useApproveStep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useRejectStep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useCancelRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  };
});

const workflow: WorkflowDefinition = {
  id: 'wf_1',
  workspaceId: 'ws_1',
  lineageId: 'wflin_1',
  name: 'Nightly report',
  instructions: '',
  steps: [
    { id: 's1', kind: 'generate', description: 'Summarise the day', input: 'summarise' },
    { id: 's2', kind: 'tool', description: 'Send it', toolId: 'mailer', input: 'x' },
  ],
  allowedTools: ['mailer'],
  approvalPolicy: 'mutations',
  limits: { maxSteps: 20, maxToolCalls: 30, maxDurationMs: 300000, maxRetriesPerStep: 2 },
  version: 1,
  createdBy: 'u1',
  createdAt: Date.now(),
  archived: false,
};

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workflowsApi.useWorkflows).mockReturnValue({
    data: [workflow],
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(workflowsApi.useCreateWorkflow).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useArchiveWorkflow).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useStartWorkflowRun).mockReturnValue(idle() as never);
  vi.mocked(agentsApi.useAgentRuns).mockReturnValue({ data: [] } as never);
});

describe('workflows page', () => {
  it('describes a workflow by its steps and when it will pause', async () => {
    renderPage();

    expect(await screen.findByText('Nightly report')).toBeInTheDocument();
    expect(screen.getByText(/2 steps/)).toBeInTheDocument();
    expect(screen.getByText(/asks before changes/)).toBeInTheDocument();
  });

  it('states that the run note does not change what runs', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Nightly report'));

    // The opposite of the agent page, where the task IS the instruction.
    // Getting this wrong would teach a user that a workflow can be steered.
    expect(screen.getByText(/does not change what runs/)).toBeInTheDocument();
  });

  it('shows a tool step as mutating unless it was declared read-only', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Nightly report'));

    expect(screen.getByText(/treated as mutating/)).toBeInTheDocument();
  });

  it('labels a run AUTHORED rather than borrowing the agent wording', async () => {
    const user = userEvent.setup();
    const run: AgentRun = {
      id: 'run_1',
      agentId: workflow.id,
      agentVersion: 1,
      lineageId: workflow.lineageId,
      workspaceId: 'ws_1',
      requestedBy: 'u1',
      task: '',
      state: 'completed',
      steps: [],
      toolCallsUsed: 0,
      log: [],
      createdAt: Date.now(),
    };
    const result: WorkflowRunResult = {
      run,
      runtime: {
        mode: 'authored',
        notice:
          'AUTHORED: this run executed the steps written into the workflow, in order, with nothing improvised. It is repeatable by design.',
        planOrigin: 'authored',
      },
    };
    vi.mocked(workflowsApi.useStartWorkflowRun).mockReturnValue(
      idle({ mutate: vi.fn((_v, opts) => opts?.onSuccess?.(result)) }) as never,
    );

    renderPage();
    await user.click(await screen.findByText('Nightly report'));
    await user.click(screen.getByRole('button', { name: /^run$/i }));

    expect(await screen.findByText(/AUTHORED — repeatable, not improvised/)).toBeInTheDocument();
    expect(screen.getByText(/nothing improvised/)).toBeInTheDocument();
  });

  it('surfaces the server\'s save-time refusal verbatim', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const error = new Error(
      'this workflow cannot run as written: step s1 uses tool "exfil", which this agent is not permitted to call',
    );
    vi.mocked(workflowsApi.useCreateWorkflow).mockReturnValue(
      idle({ mutate: vi.fn((_v, opts) => opts?.onError?.(error)) }) as never,
    );
    const toastError = vi.spyOn(toast, 'error');

    renderPage();
    await user.click(screen.getByRole('button', { name: /new workflow/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'Broken');
    await user.click(screen.getByRole('button', { name: /text step/i }));
    await user.click(screen.getByRole('button', { name: /save workflow/i }));

    // Which step is wrong is the whole value of the message. "Invalid
    // workflow" would make the author hunt for it.
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('step s1'));
  });

  it('cannot save a workflow with no steps', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /new workflow/i }));

    expect(screen.getByRole('button', { name: /save workflow/i })).toBeDisabled();
    expect(screen.getByText(/needs at least one step/)).toBeInTheDocument();
  });

  it('adds, reorders and removes steps with ids kept sequential', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /new workflow/i }));

    await user.click(screen.getByRole('button', { name: /text step/i }));
    await user.click(screen.getByRole('button', { name: /tool step/i }));
    expect(screen.getByLabelText('Description for step s1')).toHaveValue('Generate text');
    expect(screen.getByLabelText('Description for step s2')).toHaveValue('Call a tool');

    await user.click(screen.getByRole('button', { name: /move step s2 up/i }));
    // Ids follow position, so the tool step is now s1. Renumbering keeps
    // the run record readable — a gap would be legal but confusing.
    expect(screen.getByLabelText('Description for step s1')).toHaveValue('Call a tool');

    await user.click(screen.getByRole('button', { name: /remove step s1/i }));
    expect(screen.getByLabelText('Description for step s1')).toHaveValue('Generate text');
    expect(screen.queryByLabelText('Description for step s2')).not.toBeInTheDocument();
  });

  it('shows an empty state before any workflow exists', async () => {
    vi.mocked(workflowsApi.useWorkflows).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never);

    renderPage();
    expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
  });
});
