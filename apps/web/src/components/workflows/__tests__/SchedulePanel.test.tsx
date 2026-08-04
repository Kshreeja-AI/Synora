/**
 * Schedule panel tests.
 *
 * The assertion that matters most is the missed-occurrence warning. The
 * server deliberately does not replay a backlog after an outage — the
 * right call, because replaying would fire a burst of real runs — but
 * skipping is only honest if the user can see it happened. A schedule
 * silently not running looks exactly like one running fine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SchedulePanel } from '../SchedulePanel';
import * as workflowsApi from '@/lib/api/workflows';
import type { WorkflowSchedule } from '@/lib/api/workflows';

vi.mock('@/lib/api/workflows', async () => {
  const actual = await vi.importActual<typeof workflowsApi>('@/lib/api/workflows');
  return {
    ...actual,
    useWorkflowSchedules: vi.fn(),
    useCreateSchedule: vi.fn(),
    useSetScheduleEnabled: vi.fn(),
    useDeleteSchedule: vi.fn(),
  };
});

function makeSchedule(overrides: Partial<WorkflowSchedule> = {}): WorkflowSchedule {
  return {
    id: 'sched_1',
    workspaceId: 'ws_1',
    workflowId: 'wf_1',
    kind: 'daily',
    atMinuteUtc: 9 * 60,
    enabled: true,
    createdBy: 'u1',
    createdAt: Date.now(),
    nextFireAt: Date.now() + 3_600_000,
    missedOccurrences: 0,
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
      <SchedulePanel workspaceId="ws_1" workflowId="wf_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workflowsApi.useWorkflowSchedules).mockReturnValue({
    data: [],
    isLoading: false,
  } as never);
  vi.mocked(workflowsApi.useCreateSchedule).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useSetScheduleEnabled).mockReturnValue(idle() as never);
  vi.mocked(workflowsApi.useDeleteSchedule).mockReturnValue(idle() as never);
});

describe('SchedulePanel', () => {
  it('says plainly when a workflow is not scheduled', () => {
    renderPanel();
    expect(screen.getByText(/runs only when someone starts it/)).toBeInTheDocument();
  });

  it('describes a daily schedule in UTC and an interval in plain units', () => {
    vi.mocked(workflowsApi.useWorkflowSchedules).mockReturnValue({
      data: [
        makeSchedule(),
        makeSchedule({ id: 'sched_2', kind: 'interval', intervalMs: 2 * 3_600_000 }),
      ],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText('daily at 09:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('every 2 hours')).toBeInTheDocument();
  });

  it('shows missed occurrences as a warning and says they were not run later', () => {
    vi.mocked(workflowsApi.useWorkflowSchedules).mockReturnValue({
      data: [makeSchedule({ missedOccurrences: 47 })],
      isLoading: false,
    } as never);

    renderPanel();

    // The whole point: a schedule that silently did not run looks
    // identical to one running fine.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/47 scheduled runs did not happen/);
    expect(alert).toHaveTextContent(/not.*run later/i);
  });

  it('does not show a warning when nothing was missed', () => {
    vi.mocked(workflowsApi.useWorkflowSchedules).mockReturnValue({
      data: [makeSchedule({ missedOccurrences: 0 })],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('pauses an active schedule', async () => {
    const user = userEvent.setup();
    const setEnabled = vi.fn();
    vi.mocked(workflowsApi.useSetScheduleEnabled).mockReturnValue(
      idle({ mutate: setEnabled }) as never,
    );
    vi.mocked(workflowsApi.useWorkflowSchedules).mockReturnValue({
      data: [makeSchedule()],
      isLoading: false,
    } as never);

    renderPanel();
    await user.click(screen.getByRole('button', { name: /pause schedule/i }));

    expect(setEnabled).toHaveBeenCalledWith(
      { scheduleId: 'sched_1', enabled: false },
      expect.anything(),
    );
  });

  it('creates a daily schedule from the chosen hour', async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    vi.mocked(workflowsApi.useCreateSchedule).mockReturnValue(idle({ mutate: create }) as never);

    renderPanel();
    await user.clear(screen.getByLabelText(/hour \(utc\)/i));
    await user.type(screen.getByLabelText(/hour \(utc\)/i), '14');
    await user.click(screen.getByRole('button', { name: /add schedule/i }));

    expect(create).toHaveBeenCalledWith(
      { workflowId: 'wf_1', input: { kind: 'daily', atMinuteUtc: 14 * 60 } },
      expect.anything(),
    );
  });

  it('creates an interval schedule in milliseconds from minutes', async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    vi.mocked(workflowsApi.useCreateSchedule).mockReturnValue(idle({ mutate: create }) as never);

    renderPanel();
    await user.selectOptions(screen.getByLabelText(/repeat/i), 'interval');
    await user.clear(screen.getByLabelText(/minutes/i));
    await user.type(screen.getByLabelText(/minutes/i), '30');
    await user.click(screen.getByRole('button', { name: /add schedule/i }));

    expect(create).toHaveBeenCalledWith(
      { workflowId: 'wf_1', input: { kind: 'interval', intervalMs: 30 * 60_000 } },
      expect.anything(),
    );
  });

  it('states the tick resolution and whose permissions a scheduled run uses', () => {
    renderPanel();
    // Both are things a user would otherwise have to guess, and guessing
    // wrong about either matters.
    expect(screen.getByText(/at or shortly after/)).toBeInTheDocument();
    expect(screen.getByText(/uses your permissions/)).toBeInTheDocument();
  });
});
