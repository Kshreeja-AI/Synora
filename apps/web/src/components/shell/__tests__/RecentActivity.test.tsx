/**
 * The recent-activity panel.
 *
 * What matters here: the server's sentence is rendered verbatim (one
 * wording per event), history never claims attention, and the boundary
 * with the audit log is stated on the panel itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecentActivity } from '../RecentActivity';
import * as activityApi from '@/lib/api/activity';

vi.mock('@/lib/api/activity', async () => {
  const actual = await vi.importActual<typeof activityApi>('@/lib/api/activity');
  return { ...actual, useWorkspaceActivity: vi.fn() };
});

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log_1',
    sentence: 'Priya uploaded quarterly.csv',
    actor: { id: 'u2', name: 'Priya' },
    action: 'asset.uploaded',
    targetType: 'asset',
    targetId: 'a1',
    at: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecentActivity workspaceId="ws_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(activityApi.useWorkspaceActivity).mockReturnValue({
    data: [entry()],
    isLoading: false,
  } as never);
});

describe('RecentActivity', () => {
  it('renders the server\'s sentence verbatim, with a time beside it', () => {
    renderPanel();
    // One wording per event. Composing a second one here could drift from
    // what was actually recorded.
    expect(screen.getByText('Priya uploaded quarterly.csv')).toBeInTheDocument();
    expect(screen.getByText(/1h ago/)).toBeInTheDocument();
  });

  it('says where governance history lives, so its absence is not confusing', () => {
    renderPanel();
    expect(screen.getByText(/Membership, roles and billing history live in the audit log/)).toBeInTheDocument();
  });

  it('shows an honest empty state before anything has happened', () => {
    vi.mocked(activityApi.useWorkspaceActivity).mockReturnValue({
      data: [],
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it('claims no attention: no unread counts, no badges, no catch-up prompts', () => {
    vi.mocked(activityApi.useWorkspaceActivity).mockReturnValue({
      data: [entry(), entry({ id: 'log_2', sentence: 'Ade created the project “Q3”' })],
      isLoading: false,
    } as never);

    renderPanel();
    // History is for reading when wanted. A feed that demands to be
    // caught up on stops being read at all.
    expect(screen.queryByText(/unread|new activity|catch up/i)).not.toBeInTheDocument();
  });

  it('renders nothing while loading', () => {
    vi.mocked(activityApi.useWorkspaceActivity).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });
});
