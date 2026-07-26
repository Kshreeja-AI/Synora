import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePlans,
  useSubscription,
  useCreditBalance,
  useUsageSummary,
  useCreateCheckoutSession,
  useChangePlan,
  useCancelSubscription,
  useReactivateSubscription,
} from '../useBilling';
import * as billingApi from '../../lib/api/billing';

vi.mock('../../lib/api/billing');
vi.mock('../../lib/auth/token-storage', () => ({
  getAccessToken: vi.fn(() => 'test_token'),
}));

describe('useBilling hooks', () => {
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

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('usePlans', () => {
    it('fetches and returns plans', async () => {
      const mockPlans = [
        { id: '1', key: 'basic', name: 'Basic', interval: 'MONTH' as const, priceCents: 9999, creditsPerInterval: 5000, features: {}, trialDays: 0, sortOrder: 1, status: 'ACTIVE' as const, isDefault: false },
        { id: '2', key: 'pro', name: 'Pro', interval: 'MONTH' as const, priceCents: 19999, creditsPerInterval: 10000, features: {}, trialDays: 0, sortOrder: 2, status: 'ACTIVE' as const, isDefault: false },
      ];

      vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans);

      const { result } = renderHook(() => usePlans(), { wrapper });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockPlans);
    });

    it('handles fetch error', async () => {
      vi.mocked(billingApi.listPlans).mockRejectedValue(new Error('Fetch failed'));

      const { result } = renderHook(() => usePlans(), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe('useSubscription', () => {
    it('fetches subscription data', async () => {
      const mockSubscription = {
        id: 'sub_123',
        status: 'ACTIVE' as const,
        planId: 'plan_1',
      };

      vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription);

      const { result } = renderHook(() => useSubscription('workspace_1'), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockSubscription);
    });
  });

  describe('useCreditBalance', () => {
    it('fetches credit balance', async () => {
      const mockBalance = { balance: 5000, creditsUsed: 1000, creditsGranted: 6000 };

      vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance);

      const { result } = renderHook(() => useCreditBalance('workspace_1'), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockBalance);
    });
  });

  describe('useUsageSummary', () => {
    it('fetches usage summary', async () => {
      const mockSummary = {
        text_generation: { quantity: 100, creditsCost: 250 },
        image_generation: { quantity: 5, creditsCost: 500 },
      };

      vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary);

      const { result } = renderHook(() => useUsageSummary('workspace_1'), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockSummary);
    });
  });

  describe('useCreateCheckoutSession', () => {
    it('creates checkout session', async () => {
      const mockSession = { url: 'https://checkout.stripe.com/session', sessionId: 'cs_123' };

      vi.mocked(billingApi.createCheckoutSession).mockResolvedValue(mockSession);

      const { result } = renderHook(() => useCreateCheckoutSession('workspace_1'), { wrapper });

      result.current.mutate({
        planId: 'plan_1',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockSession);
    });
  });

  describe('useChangePlan', () => {
    it('changes subscription plan', async () => {
      const mockUpdated = { id: 'sub_123', planId: 'plan_2', status: 'ACTIVE' as const };

      vi.mocked(billingApi.changePlan).mockResolvedValue(mockUpdated);

      const { result } = renderHook(() => useChangePlan('workspace_1'), { wrapper });

      result.current.mutate({ planId: 'plan_2' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockUpdated);
    });
  });

  describe('useCancelSubscription', () => {
    it('cancels subscription', async () => {
      const mockCanceled = { id: 'sub_123', status: 'CANCELED' as const };

      vi.mocked(billingApi.cancelSubscription).mockResolvedValue(mockCanceled);

      const { result } = renderHook(() => useCancelSubscription('workspace_1'), { wrapper });

      result.current.mutate({ atPeriodEnd: false });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockCanceled);
    });
  });

  describe('useReactivateSubscription', () => {
    it('reactivates subscription', async () => {
      const mockReactivated = { id: 'sub_123', status: 'ACTIVE' as const };

      vi.mocked(billingApi.reactivateSubscription).mockResolvedValue(mockReactivated);

      const { result } = renderHook(() => useReactivateSubscription('workspace_1'), { wrapper });

      result.current.mutate();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockReactivated);
    });
  });
});
