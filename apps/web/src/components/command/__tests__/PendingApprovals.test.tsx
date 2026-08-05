/**
 * The approval list.
 *
 * The properties under test: consequences are stated BEFORE the buttons are
 * reachable, an expired item is shown rather than silently vanishing, and
 * the decision request carries nothing that could influence what runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingApprovals } from '../PendingApprovals';
import * as commandApi from '@/lib/api/command';

vi.mock('@/lib/api/command', async () => {
  const actual = await vi.importActual<typeof commandApi>('@/lib/api/command');
  return { ...actual, useCommandExecutions: vi.fn(), useDecideCommand: vi.fn() };
});

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec_1',
    commandText: 'Run the deployment tool',
    capabilityId: 'tool.execute',
    riskClass: 'sensitive',
    state: 'waiting-approval',
    approvalState: 'pending',
    approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    requestedBy: 'u1',
    createdAt: new Date().toISOString(),
    message: null,
    ...overrides,
  };
}

const mutate = vi.fn();

function renderList(items: ReturnType<typeof item>[]) {
  vi.mocked(commandApi.useCommandExecutions).mockReturnValue({
    data: { items, total: items.length },
    isLoading: false,
  } as never);
  vi.mocked(commandApi.useDecideCommand).mockReturnValue({
    mutate,
    isPending: false,
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PendingApprovals workspaceId="ws_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingApprovals', () => {
  it('states the consequence and the deadline before either button', () => {
    renderList([item()]);
    expect(
      screen.getByText(/Leaves Synora, spends money, or changes who can do what/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can answer this until/i)).toBeInTheDocument();
    // Said before the click, not in a dialog after it: approving is not
    // scheduling, it performs the thing.
    expect(screen.getByText(/Approving runs this immediately/i)).toBeInTheDocument();
  });

  it('sends only a decision — never anything that could select the action', () => {
    renderList([item()]);
    fireEvent.click(screen.getByRole('button', { name: /approve and run it/i }));

    const payload = mutate.mock.calls[0][0];
    expect(payload).toEqual({ executionId: 'exec_1', decision: 'approved' });
    // The server re-derives the action from its own record. A convenience
    // field here would quietly undo the approval gate's strongest guarantee.
    expect(payload).not.toHaveProperty('capabilityId');
    expect(payload).not.toHaveProperty('command');
  });

  it('records a reason with a refusal', () => {
    renderList([item()]);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'wrong environment' } });
    fireEvent.click(screen.getByRole('button', { name: /refuse/i }));

    expect(mutate.mock.calls[0][0]).toEqual({
      executionId: 'exec_1',
      decision: 'rejected',
      reason: 'wrong environment',
    });
  });

  it('shows an expired item with no buttons, rather than hiding it', () => {
    renderList([
      item({ approvalExpiresAt: new Date(Date.now() - 1_000).toISOString(), state: 'expired' }),
    ]);
    // Someone looking for what they asked for should find it and learn why
    // it can no longer be answered.
    expect(screen.getByText('Run the deployment tool')).toBeInTheDocument();
    expect(screen.getByText(/can no longer be approved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refuse/i })).not.toBeInTheDocument();
  });

  it('says nothing is waiting, without congratulating anyone', () => {
    renderList([]);
    const text = screen.getByRole('region', { name: /waiting for a decision/i }).textContent ?? '';
    expect(text).toMatch(/No command is waiting/i);
    // An empty queue is not an achievement, and treating it as one implies
    // it is a thing to be emptied.
    expect(text).not.toMatch(/caught up|all done|great|🎉/i);
  });
});
