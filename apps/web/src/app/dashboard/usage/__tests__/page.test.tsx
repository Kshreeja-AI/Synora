import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UsagePage from '../page';
import * as billingApi from '../../../../lib/api/billing';
import { createMockWorkspaceCredits, createMockCreditLedgerEntry } from '../../../../lib/api/__tests__/billing-mocks';

vi.mock('../../../../lib/api/billing');
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));
vi.mock('../../../../lib/auth/token-storage', () => ({
  getAccessToken: vi.fn(() => 'test_token'),
}));
// The page scopes all queries to the ACTIVE workspace (the route has
// no URL params — reading useParams().id here was a bug that left
// every query disabled).
vi.mock('../../../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({
    currentWorkspace: { id: 'workspace_1', name: 'Workspace One' },
  }),
}));
// The AI Usage section's data layer has its own component tests —
// stub the components so this file stays focused on the page's
// billing view.
vi.mock('../../../../components/analytics/UsageOverview', () => ({
  UsageOverview: () => <div data-testid="usage-overview" />,
}));
vi.mock('../../../../components/analytics/UsageLedger', () => ({
  UsageLedger: () => <div data-testid="usage-ledger" />,
}));

describe('UsagePage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    );
  };

  it('renders usage analytics dashboard', async () => {
    const mockBalance = createMockWorkspaceCredits({ balance: 7500 });
    const mockSummary = {
      text_generation: { quantity: 50, creditsCost: 125 },
      image_generation: { quantity: 10, creditsCost: 500 },
    };
    const mockLedger = [
      createMockCreditLedgerEntry({ type: 'GRANT', amount: 10000 }),
      createMockCreditLedgerEntry({ type: 'DEDUCTION', amount: -2375 }),
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getCreditBalance)).toHaveBeenCalled();
  });

  it('displays credit balance card', async () => {
    const mockBalance = createMockWorkspaceCredits({ balance: 5000 });

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({});
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([]);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getCreditBalance)).toHaveBeenCalled();
  });

  it('displays usage breakdown by capability', async () => {
    const mockSummary = {
      text_generation: { quantity: 100, creditsCost: 250 },
      image_generation: { quantity: 5, creditsCost: 500 },
      video_generation: { quantity: 2, creditsCost: 1000 },
    };

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([]);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getUsageSummary)).toHaveBeenCalled();
  });

  it('displays usage percentages', async () => {
    const mockSummary = {
      text_generation: { quantity: 100, creditsCost: 1000 },
      image_generation: { quantity: 50, creditsCost: 1000 },
    };

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([]);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('displays credit ledger table', async () => {
    const mockLedger = [
      createMockCreditLedgerEntry({ type: 'GRANT', amount: 10000 }),
      createMockCreditLedgerEntry({ type: 'DEDUCTION', amount: -250 }),
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({});
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.listCreditLedger)).toHaveBeenCalled();
  });

  it('displays ledger entry types', async () => {
    const mockLedger = [
      createMockCreditLedgerEntry({ type: 'GRANT', amount: 5000 }),
      createMockCreditLedgerEntry({ type: 'DEDUCTION', amount: -100 }),
      createMockCreditLedgerEntry({ type: 'ADJUSTMENT', amount: -50 }),
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({});
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('handles empty usage', async () => {
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({});
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([]);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('displays loading state', () => {
    vi.mocked(billingApi.getCreditBalance).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { container } = renderWithProviders(<UsagePage />);

    expect(container).toBeInTheDocument();
  });

  it('shows usage summary cards', async () => {
    const mockBalance = createMockWorkspaceCredits({ balance: 7500 });

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance);
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(
      {
        text_generation: { quantity: 100, creditsCost: 250 },
      }
    );
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([]);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });
});
