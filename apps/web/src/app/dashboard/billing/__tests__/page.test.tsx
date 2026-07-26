import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BillingPage from '../page';
import * as billingApi from '../../../../lib/api/billing';

vi.mock('../../../../lib/api/billing');
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders billing plans page', async () => {
    const mockPlans = [
      {
        id: '1',
        name: 'Basic',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: { text_generation: true },
      },
      {
        id: '2',
        name: 'Pro',
        interval: 'MONTH',
        priceCents: 19999,
        creditsPerInterval: 10000,
        features: { text_generation: true, image_generation: true },
      },
    ];

    const mockSubscription = {
      id: 'sub_1',
      planId: '1',
      status: 'ACTIVE',
    };

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Basic')).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
  });

  it('shows current plan badge', async () => {
    const mockPlans = [
      {
        id: '1',
        name: 'Basic',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
      },
    ];

    const mockSubscription = {
      id: 'sub_1',
      planId: '1',
      status: 'ACTIVE',
    };

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/current plan/i)).toBeInTheDocument();
    });
  });

  it('displays loading state', async () => {
    vi.mocked(billingApi.listPlans).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<BillingPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('handles plan selection', async () => {
    const mockPlans = [
      {
        id: '1',
        name: 'Basic',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
      },
      {
        id: '2',
        name: 'Pro',
        interval: 'MONTH',
        priceCents: 19999,
        creditsPerInterval: 10000,
        features: {},
      },
    ];

    const mockSubscription = {
      id: 'sub_1',
      planId: '1',
      status: 'ACTIVE',
    };

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.changePlan).mockResolvedValue({ ...mockSubscription, planId: '2' } as any);

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });

    const selectButton = screen.getByRole('button', { name: /select.*pro/i });
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(billingApi.changePlan).toHaveBeenCalledWith({ planId: '2' });
    });
  });

  it('displays pricing information', async () => {
    const mockPlans = [
      {
        id: '1',
        name: 'Basic',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
      },
    ];

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue({ planId: '2', status: 'ACTIVE' } as any);

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/\$99.99/)).toBeInTheDocument();
    });
  });

  it('displays credits per interval', async () => {
    const mockPlans = [
      {
        id: '1',
        name: 'Basic',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        features: {},
      },
    ];

    vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);
    vi.mocked(billingApi.getSubscription).mockResolvedValue({ planId: '2', status: 'ACTIVE' } as any);

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/5000.*credit/i)).toBeInTheDocument();
    });
  });
});
