import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBilling } from '../useBilling';
import * as billingApi from '../../lib/api/billing';

vi.mock('../../lib/api/billing');

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
        { id: '1', name: 'Basic', priceCents: 9999 },
        { id: '2', name: 'Pro', priceCents: 19999 },
      ];

      vi.mocked(billingApi.listPlans).mockResolvedValue(mockPlans as any);

      const { result } = renderHook(() => useBilling().usePlans(), { wrapper });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockPlans);
    });

    it('handles fetch error', async () => {
      vi.mocked(billingApi.listPlans).mockRejectedValue(new Error('Fetch failed'));

      const { result } = renderHook(() => useBilling().usePlans(), { wrapper });

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
        status: 'ACTIVE',
        planId: 'plan_1',
      };

      vi.mocked(billingApi.getSubscription).mockResolvedValue(mockSubscription as any);

      const { result } = renderHook(() => useBilling().useSubscription(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockSubscription);
    });
  });

  describe('useCreditBalance', () => {
    it('fetches credit balance', async () => {
      const mockBalance = { balance: 5000 };

      vi.mocked(billingApi.getCreditBalance).mockResolvedValue(mockBalance as any);

      const { result } = renderHook(() => useBilling().useCreditBalance(), { wrapper });

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

      vi.mocked(billingApi.getUsageSummary).mockResolvedValue(mockSummary as any);

      const { result } = renderHook(() => useBilling().useUsageSummary(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockSummary);
    });
  });

  describe('useCreateCheckoutSession', () => {
    it('creates checkout session', async () => {
      const mockSession = { url: 'https://checkout.stripe.com/session' };

      vi.mocked(billingApi.createCheckoutSession).mockResolvedValue(mockSession as any);

      const { result } = renderHook(() => useBilling().useCreateCheckoutSession(), { wrapper });

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
      const mockUpdated = { id: 'sub_123', planId: 'plan_2' };

      vi.mocked(billingApi.changePlan).mockResolvedValue(mockUpdated as any);

      const { result } = renderHook(() => useBilling().useChangePlan(), { wrapper });

      result.current.mutate({ planId: 'plan_2' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockUpdated);
    });
  });

  describe('useCancelSubscription', () => {
    it('cancels subscription', async () => {
      const mockCanceled = { id: 'sub_123', status: 'CANCELED' };

      vi.mocked(billingApi.cancelSubscription).mockResolvedValue(mockCanceled as any);

      const { result } = renderHook(() => useBilling().useCancelSubscription(), { wrapper });

      result.current.mutate({ atPeriodEnd: false });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockCanceled);
    });
  });

  describe('useReactivateSubscription', () => {
    it('reactivates subscription', async () => {
      const mockReactivated = { id: 'sub_123', cancelAtPeriodEnd: false };

      vi.mocked(billingApi.reactivateSubscription).mockResolvedValue(mockReactivated as any);

      const { result } = renderHook(() => useBilling().useReactivateSubscription(), { wrapper });

      result.current.mutate();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockReactivated);
    });
  });
});
