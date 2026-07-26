import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsBillingPage from '../page';
import * as billingApi from '../../../../../lib/api/billing';

vi.mock('../../../../../lib/api/billing');

describe('SettingsBillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders subscription management page', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: {
        id: 'plan_1',
        name: 'Pro',
        priceCents: 19999,
        creditsPerInterval: 10000,
        features: { text_generation: true },
      },
    };

    const mockBalance = { balance: 5000 };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
  });

  it('displays current plan details', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: {
        id: 'plan_1',
        name: 'Pro',
        priceCents: 19999,
        creditsPerInterval: 10000,
        features: { text_generation: true, image_generation: true },
      },
    };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/\$199.99/)).toBeInTheDocument();
    });
  });

  it('displays credits balance', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: { id: 'plan_1', name: 'Basic', priceCents: 9999, features: {} },
    };

    const mockBalance = { balance: 7500 };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/7500/)).toBeInTheDocument();
    });
  });

  it('shows plan features list', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: {
        id: 'plan_1',
        name: 'Pro',
        priceCents: 19999,
        features: { text_generation: true, image_generation: true, video_generation: false },
      },
    };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/text generation/i)).toBeInTheDocument();
      expect(screen.getByText(/image generation/i)).toBeInTheDocument();
    });
  });

  it('provides cancel subscription button', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: { id: 'plan_1', name: 'Basic', priceCents: 9999, features: {} },
    };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });

  it('shows danger zone for subscription cancellation', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: { id: 'plan_1', name: 'Basic', priceCents: 9999, features: {} },
    };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/danger/i)).toBeInTheDocument();
    });
  });

  it('handles cancel subscription click', async () => {
    const mockSubscription = {
      id: 'sub_1',
      planId: 'plan_1',
      status: 'ACTIVE',
      plan: { id: 'plan_1', name: 'Basic', priceCents: 9999, features: {} },
    };

    vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);
    vi.mocked(billingApi.getCreditBalance).mockResolvedValue({ balance: 5000 } as any);
    vi.mocked(billingApi.cancelSubscription).mockResolvedValue({
      ...mockSubscription,
      status: 'CANCELED',
    } as any);

    render(<SettingsBillingPage />);

    await waitFor(() => {
      const cancelButton = screen.getByRole('button', { name: /cancel.*subscription/i });
      fireEvent.click(cancelButton);
    });

    await waitFor(() => {
      expect(billingApi.cancelSubscription).toHaveBeenCalled();
    });
  });

  it('displays loading state', () => {
    vi.mocked(billingApi.getSubscription).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<SettingsBillingPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
