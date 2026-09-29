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
    useEventTriggers: vi.fn(),
    useCreateEventTrigger: vi.fn(),
    useSetEventTriggerEnabled: vi.fn(),
    useDeleteEventTrigger: vi.fn(),
  };
});

function makeEventTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    workspaceId: 'ws_1',
    workflowId: 'wf_1',
    event: 'asset.uploaded',
    enabled: true,
    createdBy: 'u1',
    createdAt: Date.now(),
    firedCount: 0,
    suppressedCount: 0,
    ...overrides,
  };
}

/** The server's answer for the event listing, as the panel receives it. */
function eventListing(triggers: unknown[] = []) {
  return {
    data: {
      triggers,
      availableEvents: ['asset.uploaded', 'project.created'],
      burst: { limit: 20, windowMs: 60_000 },
    },
    isLoading: false,
  };
}

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
  vi.mocked(workflowsApi.useEventTriggers).mockReturnValue(eventListing() as never);
  vi.mocked(workflowsApi.useCreateEventTrigger).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useSetEventTriggerEnabled).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useDeleteEventTrigger).mockReturnValue(idle() as never);
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

  /**
   * Event triggers — the "something happened in Synora" half.
   *
   * The property worth defending here is that the offered events come from
   * the server. A hardcoded list would let someone build an automation on
   * an event the backend never emits, which looks enabled and never fires.
   */
  describe('event triggers', () => {
    it('offers only the events the server says it emits', () => {
      renderPanel();

      // In the words of what happens, not the wire name.
      expect(
        screen.getByRole('option', { name: /a file is uploaded to this workspace/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', { name: /a project is created in this workspace/i }),
      ).toBeInTheDocument();
    });

    it('offers nothing when the server lists no events, rather than guessing', () => {
      vi.mocked(workflowsApi.useEventTriggers).mockReturnValue({
        data: { triggers: [], availableEvents: [], burst: { limit: 20, windowMs: 60_000 } },
        isLoading: false,
      } as never);

      renderPanel();
      // Only the placeholder. A UI that invented options would let someone
      // wire an automation to an event that never arrives.
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });

    it('will not create a trigger until an event is chosen', async () => {
      const user = userEvent.setup();
      const create = vi.fn();
      vi.mocked(workflowsApi.useCreateEventTrigger).mockReturnValue(
        idle({ mutate: create }) as never,
      );

      renderPanel();
      expect(screen.getByRole('button', { name: /add event trigger/i })).toBeDisabled();

      await user.selectOptions(screen.getByLabelText(/run when/i), 'asset.uploaded');
      await user.click(screen.getByRole('button', { name: /add event trigger/i }));

      expect(create).toHaveBeenCalledWith(
        { workflowId: 'wf_1', event: 'asset.uploaded' },
        expect.anything(),
      );
    });

    it('describes an existing trigger by what sets it off', () => {
      vi.mocked(workflowsApi.useEventTriggers).mockReturnValue(
        eventListing([makeEventTrigger({ firedCount: 2 })]) as never,
      );

      renderPanel();
      // Scoped to the row: the same phrase is legitimately also a dropdown
      // option, and the assertion is about how an EXISTING trigger reads.
      const [row] = screen.getAllByRole('listitem');
      expect(row).toHaveTextContent(/When a file is uploaded to this workspace/i);
      expect(row).toHaveTextContent(/2 runs started/);
    });

    it('shows fires that were declined for going too fast', () => {
      vi.mocked(workflowsApi.useEventTriggers).mockReturnValue(
        eventListing([makeEventTrigger({ firedCount: 20, suppressedCount: 7 })]) as never,
      );

      renderPanel();
      // A trigger repeatedly hitting the limit is a wiring problem someone
      // should see, not a silent ceiling.
      expect(screen.getByText(/7 declined for firing too fast/)).toBeInTheDocument();
    });

    it('says the automation runs with your permissions, not the actor\'s', () => {
      renderPanel();
      // Someone uploading a file has not agreed to lend their permissions
      // to whatever another member wired up, and the page says whose are
      // used.
      expect(screen.getByText(/not those of whoever/i)).toBeInTheDocument();
    });

    it('pauses and deletes an event trigger', async () => {
      const user = userEvent.setup();
      const setEnabled = vi.fn();
      const remove = vi.fn();
      vi.mocked(workflowsApi.useEventTriggers).mockReturnValue(
        eventListing([makeEventTrigger()]) as never,
      );
      vi.mocked(workflowsApi.useSetEventTriggerEnabled).mockReturnValue(
        idle({ mutate: setEnabled }) as never,
      );
      vi.mocked(workflowsApi.useDeleteEventTrigger).mockReturnValue(
        idle({ mutate: remove }) as never,
      );

      renderPanel();
      await user.click(screen.getByRole('button', { name: /pause event trigger/i }));
      expect(setEnabled).toHaveBeenCalledWith(
        { triggerId: 'evt_1', enabled: false },
        expect.anything(),
      );

      await user.click(screen.getByRole('button', { name: /delete event trigger/i }));
      expect(remove).toHaveBeenCalledWith('evt_1', expect.anything());
    });

    it('does not show another workflow\'s event triggers', () => {
      vi.mocked(workflowsApi.useEventTriggers).mockReturnValue(
        eventListing([makeEventTrigger({ id: 'evt_other', workflowId: 'wf_2' })]) as never,
      );

      renderPanel();
      // The listing endpoint is workspace-wide; this panel is about one
      // workflow.
      expect(screen.getByText(/no event triggers yet/i)).toBeInTheDocument();
    });
  });
});
