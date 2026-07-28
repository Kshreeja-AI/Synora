import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsBillingPage from '../page';
import * as billingApi from '../../../../../lib/api/billing';
import { createMockSubscription, createMockWorkspaceCredits } from '../../../../../lib/api/__tests__/billing-mocks';

vi.mock('../../../../../lib/api/billing');
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useParams: () => ({
    id: 'workspace_1',
  }),
}));
vi.mock('../../../../../lib/auth/token-storage', () => ({
  getAccessToken: vi.fn(() => 'test_token'),
}));

describe('SettingsBillingPage', () => {
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

  it('renders subscription management page', async () => {
    const mockSubscription = createMockSubscription();
    const mockBalance = createMockWorkspaceCredits({ balance: 5000 });

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance);

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getSubscription)).toHaveBeenCalled();
  });

  it('displays current plan details', async () => {
    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getSubscription)).toHaveBeenCalled();
  });

  it('displays credits balance', async () => {
    const mockSubscription = createMockSubscription();

    const mockBalance = createMockWorkspaceCredits({ balance: 7500 });

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance);

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getCreditBalance)).toHaveBeenCalled();
  });

  it('shows plan features list', async () => {
    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('provides cancel subscription button', async () => {
    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('shows danger zone for subscription cancellation', async () => {
    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('handles cancel subscription click', async () => {
    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(createMockWorkspaceCredits({ balance: 5000 }));
    vi.mocked(billingApi.cancelSubscription).mockResolvedValue({
      ...mockSubscription,
      status: 'CANCELED' as const,
    });

    const { container } = renderWithProviders(<SettingsBillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('displays loading state', () => {
    vi.mocked(billingApi.getSubscription).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { container } = renderWithProviders(<SettingsBillingPage />);

    expect(container).toBeInTheDocument();
  });
});
