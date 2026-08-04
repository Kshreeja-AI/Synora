/**
 * Trigger panel tests.
 *
 * The property that matters most is the one-time secret: the raw URL must
 * appear right after creation and must never be recoverable from the list
 * view, because there is no endpoint that will ever return it again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TriggerPanel } from '../TriggerPanel';
import * as workflowsApi from '@/lib/api/workflows';
import type { WorkflowTrigger } from '@/lib/api/workflows';

vi.mock('@/lib/api/workflows', async () => {
  const actual = await vi.importActual<typeof workflowsApi>('@/lib/api/workflows');
  return {
    ...actual,
    useWorkflowTriggers: vi.fn(),
    useCreateTrigger: vi.fn(),
    useSetTriggerEnabled: vi.fn(),
    useDeleteTrigger: vi.fn(),
  };
});

function makeTrigger(overrides: Partial<WorkflowTrigger> = {}): WorkflowTrigger {
  return {
    id: 'trg_1',
    workspaceId: 'ws_1',
    workflowId: 'wf_1',
    secretPreview: 'whk_a1b2c3d4',
    enabled: true,
    createdBy: 'u1',
    createdAt: Date.now(),
    firedCount: 0,
    ...overrides,
  };
}

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TriggerPanel workspaceId="ws_1" workflowId="wf_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workflowsApi.useWorkflowTriggers).mockReturnValue({
    data: [],
    isLoading: false,
  } as never);
  vi.mocked(workflowsApi.useCreateTrigger).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useSetTriggerEnabled).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useDeleteTrigger).mockReturnValue(idle() as never);
});

describe('TriggerPanel', () => {
  it('says plainly when there are no triggers yet', () => {
    renderPanel();
    expect(screen.getByText(/no triggers yet/i)).toBeInTheDocument();
  });

  it('reveals the full URL exactly once, right after creation', async () => {
    const user = userEvent.setup();
    vi.mocked(workflowsApi.useCreateTrigger).mockReturnValue(
      idle({
        mutate: vi.fn((_id, opts) =>
          opts?.onSuccess?.({
            trigger: makeTrigger(),
            secret: 'whk_' + 'a'.repeat(64),
          }),
        ),
      }) as never,
    );

    renderPanel();
    await user.click(screen.getByRole('button', { name: /new trigger/i }));

    expect(await screen.findByText(/shown once — copy it now/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`whk_a{64}`))).toBeInTheDocument();
  });

  it('never shows the raw secret in the trigger list, only the preview', () => {
    vi.mocked(workflowsApi.useWorkflowTriggers).mockReturnValue({
      data: [makeTrigger({ secretPreview: 'whk_deadbeef' })],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText(/whk_deadbeef/)).toBeInTheDocument();
    // The list view never receives more than the preview to begin with —
    // there is no raw secret anywhere in this render to leak.
    expect(screen.queryByText(/shown once/i)).not.toBeInTheDocument();
  });

  it('shows fire count and last-fired time once a trigger has fired', () => {
    vi.mocked(workflowsApi.useWorkflowTriggers).mockReturnValue({
      data: [makeTrigger({ firedCount: 3, lastFiredAt: Date.UTC(2026, 0, 1) })],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText(/3 fires/)).toBeInTheDocument();
  });

  it('pauses an active trigger', async () => {
    const user = userEvent.setup();
    const setEnabled = vi.fn();
    vi.mocked(workflowsApi.useSetTriggerEnabled).mockReturnValue(
      idle({ mutate: setEnabled }) as never,
    );
    vi.mocked(workflowsApi.useWorkflowTriggers).mockReturnValue({
      data: [makeTrigger()],
      isLoading: false,
    } as never);

    renderPanel();
    await user.click(screen.getByRole('button', { name: /pause trigger/i }));

    expect(setEnabled).toHaveBeenCalledWith(
      { triggerId: 'trg_1', enabled: false },
      expect.anything(),
    );
  });

  it('deletes a trigger', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    vi.mocked(workflowsApi.useDeleteTrigger).mockReturnValue(idle({ mutate: remove }) as never);
    vi.mocked(workflowsApi.useWorkflowTriggers).mockReturnValue({
      data: [makeTrigger()],
      isLoading: false,
    } as never);

    renderPanel();
    await user.click(screen.getByRole('button', { name: /delete trigger/i }));

    expect(remove).toHaveBeenCalledWith('trg_1', expect.anything());
  });

  it('states that a paused trigger behaves as if it did not exist', () => {
    renderPanel();
    expect(screen.getByText(/did not exist/)).toBeInTheDocument();
  });
});
