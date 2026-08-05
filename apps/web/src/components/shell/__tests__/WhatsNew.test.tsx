/**
 * The workspace "since you were last here" banner.
 *
 * The property under test is restraint: the banner exists ONLY when it
 * states something a returning person needs. First visit — absent.
 * Nothing changed — absent. Never a "0 things happened" banner, which
 * would be noise dressed as information.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WhatsNew } from '../WhatsNew';
import * as activityApi from '@/lib/api/activity';

vi.mock('@/lib/api/activity', async () => {
  const actual = await vi.importActual<typeof activityApi>('@/lib/api/activity');
  return { ...actual, useWorkspaceWhatsNew: vi.fn() };
});

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WhatsNew workspaceId="ws_1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(activityApi.useWorkspaceWhatsNew).mockReturnValue({ data: null } as never);
});

describe('WhatsNew', () => {
  it('says how much happened while you were away, and where the details are', () => {
    vi.mocked(activityApi.useWorkspaceWhatsNew).mockReturnValue({
      data: { previousVisitAt: new Date(Date.now() - 604_800_000).toISOString(), count: 7 },
    } as never);

    renderBanner();
    expect(screen.getByText(/7 things happened while you were away/)).toBeInTheDocument();
    // Points at the feed that carries the specifics, because both are
    // computed over the same events and cannot disagree.
    expect(screen.getByText(/Recent activity/)).toBeInTheDocument();
  });

  it('renders nothing on a first-ever visit', () => {
    renderBanner();
    // Everything in a workspace someone just joined is trivially "new" —
    // not an informative claim.
    expect(screen.queryByText(/while you were away/)).not.toBeInTheDocument();
  });

  it('renders nothing when nothing happened, rather than a banner about zero', () => {
    vi.mocked(activityApi.useWorkspaceWhatsNew).mockReturnValue({
      data: { previousVisitAt: new Date(Date.now() - 3_600_000).toISOString(), count: 0 },
    } as never);

    renderBanner();
    expect(screen.queryByText(/while you were away/)).not.toBeInTheDocument();
  });

  it('uses the singular for a single event', () => {
    vi.mocked(activityApi.useWorkspaceWhatsNew).mockReturnValue({
      data: { previousVisitAt: new Date(Date.now() - 3_600_000).toISOString(), count: 1 },
    } as never);

    renderBanner();
    expect(screen.getByText(/1 thing happened while you were away/)).toBeInTheDocument();
  });
});
