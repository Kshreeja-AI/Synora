/**
 * UsageOverview tests: renders the workspace summary stats and the
 * provider cost breakdown from the analytics hook. The hook is
 * mocked — the aggregation math itself is pinned by backend route
 * tests (tests/routes/usage.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageOverview } from '../UsageOverview';
import type { UsageSummary } from '@/lib/api/analytics';

const mockSummary = vi.fn<() => { data?: UsageSummary; isLoading: boolean }>();

vi.mock('@/lib/api/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/analytics')>();
  return {
    ...actual,
    useWorkspaceUsageSummary: () => mockSummary(),
  };
});

const summary: UsageSummary = {
  totalConversations: 3,
  totalMessages: 42,
  totalInputTokens: 1500,
  totalOutputTokens: 800,
  totalCostCents: 10,
  costByProvider: { anthropic: 9, openai: 1 },
  costByModel: { 'claude-sonnet-5': 9, 'gpt-4o': 1 },
  topProviders: [
    {
      provider: 'anthropic',
      inputTokens: 1200,
      outputTokens: 700,
      costCents: 9,
      percentOfTotal: 90,
    },
    { provider: 'openai', inputTokens: 300, outputTokens: 100, costCents: 1, percentOfTotal: 10 },
  ],
  dateRange: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' },
};

describe('UsageOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders headline stats from the summary', () => {
    mockSummary.mockReturnValue({ data: summary, isLoading: false });
    render(<UsageOverview workspaceId="ws" />);

    expect(screen.getByText('3')).toBeInTheDocument(); // conversations
    expect(screen.getByText('42')).toBeInTheDocument(); // messages
  });

  it('lists providers in cost order', () => {
    mockSummary.mockReturnValue({ data: summary, isLoading: false });
    render(<UsageOverview workspaceId="ws" />);

    const providers = screen.getAllByText(/anthropic|openai/);
    expect(providers[0]).toHaveTextContent('anthropic');
  });

  it('renders nothing crash-worthy while loading', () => {
    mockSummary.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<UsageOverview workspaceId="ws" />);
    expect(container).toBeInTheDocument();
  });
});
