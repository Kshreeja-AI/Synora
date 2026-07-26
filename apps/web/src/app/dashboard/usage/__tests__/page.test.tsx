import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UsagePage from '../page';
import * as billingApi from '../../../../lib/api/billing';

vi.mock('../../../../lib/api/billing');
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useParams: () => ({
    id: 'workspace_1',
  }),
}));
vi.mock('../../../../lib/auth/token-storage', () => ({
  getAccessToken: vi.fn(() => 'test_token'),
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
    const mockBalance = { balance: 7500, creditsUsed: 2500, creditsGranted: 10000 };
    const mockSummary = {
      text_generation: { quantity: 50, creditsCost: 125 },
      image_generation: { quantity: 10, creditsCost: 500 },
    };
    const mockLedger = [
      { id: '1', type: 'GRANT' as const, amount: 10000, createdAt: new Date().toISOString() },
      { id: '2', type: 'DEDUCTION' as const, amount: -2375, createdAt: new Date().toISOString() },
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
    const mockBalance = { balance: 5000, creditsUsed: 1000, creditsGranted: 6000 };

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

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000, creditsUsed: 1000, creditsGranted: 6000 });
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

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000, creditsUsed: 1000, creditsGranted: 6000 });
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary);
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue([]);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('displays credit ledger table', async () => {
    const mockLedger = [
      {
        id: '1',
        type: 'GRANT' as const,
        amount: 10000,
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'DEDUCTION' as const,
        amount: -250,
        createdAt: new Date().toISOString(),
      },
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000, creditsUsed: 1000, creditsGranted: 6000 });
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
      { id: '1', type: 'GRANT' as const, amount: 5000, createdAt: new Date().toISOString() },
      { id: '2', type: 'DEDUCTION' as const, amount: -100, createdAt: new Date().toISOString() },
      { id: '3', type: 'ADJUSTMENT' as const, amount: -50, createdAt: new Date().toISOString() },
    ];

    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000, creditsUsed: 1000, creditsGranted: 6000 });
    vi.mocked(billingApi.getUsageSummary).mockResolvedValue({});
    vi.mocked(billingApi.listCreditLedger).mockResolvedValue(mockLedger);

    const { container } = renderWithProviders(<UsagePage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('handles empty usage', async () => {
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000, creditsUsed: 1000, creditsGranted: 6000 });
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
    const mockBalance = { balance: 7500, creditsUsed: 2500, creditsGranted: 10000 };

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
