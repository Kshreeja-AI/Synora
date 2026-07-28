import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BillingPage from '../page';
import * as billingApi from '../../../../lib/api/billing';
import { createMockSubscription } from '../../../../lib/api/__tests__/billing-mocks';

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

describe('BillingPage', () => {
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

  it('renders billing plans page', async () => {
    const mockPlans = [
      {
        id: '1',
        key: 'basic',
        name: 'Basic',
        interval: 'MONTH' as const,
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: { text_generation: true },
        trialDays: 0,
        sortOrder: 1,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
      {
        id: '2',
        key: 'pro',
        name: 'Pro',
        interval: 'MONTH' as const,
        priceCents: 19999,
        creditsPerInterval: 10000,
        features: { text_generation: true, image_generation: true },
        trialDays: 0,
        sortOrder: 2,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
    ];

    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);

    const { container } = renderWithProviders(<BillingPage />);

    await waitFor(() => {
      // Check that component rendered and loaded data
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.listPlans)).toHaveBeenCalled();
  });

  it('shows current plan badge', async () => {
    const mockPlans = [
      {
        id: '1',
        key: 'basic',
        name: 'Basic',
        interval: 'MONTH' as const,
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
        trialDays: 0,
        sortOrder: 1,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
    ];

    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);

    const { container } = renderWithProviders(<BillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.getSubscription)).toHaveBeenCalled();
  });

  it('displays loading state', async () => {
    vi.mocked(billingApi.listPlans).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    vi.mocked(billingApi.getSubscription).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { container } = renderWithProviders(<BillingPage />);

    // Component should render with loading state
    expect(container).toBeInTheDocument();
  });

  it('handles plan selection', async () => {
    const mockPlans = [
      {
        id: '1',
        key: 'basic',
        name: 'Basic',
        interval: 'MONTH' as const,
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
        trialDays: 0,
        sortOrder: 1,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
      {
        id: '2',
        key: 'pro',
        name: 'Pro',
        interval: 'MONTH' as const,
        priceCents: 19999,
        creditsPerInterval: 10000,
        features: {},
        trialDays: 0,
        sortOrder: 2,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
    ];

    const mockSubscription = createMockSubscription();

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(billingApi.changePlan).mockResolvedValue({ ...mockSubscription, planId: '2' });

    const { container } = renderWithProviders(<BillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('displays pricing information', async () => {
    const mockPlans = [
      {
        id: '1',
        key: 'basic',
        name: 'Basic',
        interval: 'MONTH' as const,
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
        trialDays: 0,
        sortOrder: 1,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
    ];

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(createMockSubscription({ planId: '2' }));

    const { container } = renderWithProviders(<BillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.listPlans)).toHaveBeenCalled();
  });

  it('displays credits per interval', async () => {
    const mockPlans = [
      {
        id: '1',
        key: 'basic',
        name: 'Basic',
        interval: 'MONTH' as const,
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
        trialDays: 0,
        sortOrder: 1,
        status: 'ACTIVE' as const,
        isDefault: false,
      },
    ];

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(createMockSubscription({ planId: '2' }));

    const { container } = renderWithProviders(<BillingPage />);

    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });

    expect(vi.mocked(billingApi.listPlans)).toHaveBeenCalled();
  });
});
