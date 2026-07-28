import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as billingApi from '../billing';
import { createSuccessResponse } from './test-utils';

describe('billing API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPlans', () => {
    it('fetches active plans', async () => {
      const mockPlans = [
        { id: '1', name: 'Basic', priceCents: 9999 },
        { id: '2', name: 'Pro', priceCents: 19999 },
      ];

      const mockFetch = vi.fn().mockResolvedValue(createSuccessResponse(mockPlans));
      global.fetch = mockFetch;

      const plans = await billingApi.listPlans();

      expect(plans).toHaveLength(2);
      expect(plans[0].name).toBe('Basic');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/plans'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('handles fetch error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(billingApi.listPlans()).rejects.toThrow('Network error');
    });
  });

  describe('getSubscription', () => {
    it('fetches current subscription', async () => {
      const mockSubscription = {
        id: 'sub_123',
        status: 'ACTIVE' as const,
        planId: 'plan_1',
      };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockSubscription));

      const subscription = await billingApi.getSubscription('workspace_1');

      expect(subscription).toEqual(mockSubscription);
    });
  });

  describe('createCheckoutSession', () => {
    it('creates checkout session', async () => {
      const mockSession = { url: 'https://checkout.stripe.com/session', sessionId: 'cs_123' };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockSession));

      const session = await billingApi.createCheckoutSession('workspace_1', {
        planId: 'plan_1',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(session).toEqual(mockSession);
    });
  });

  describe('changePlan', () => {
    it('changes subscription plan', async () => {
      const mockUpdated = { id: 'sub_123', planId: 'plan_2', status: 'ACTIVE' as const };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockUpdated));

      const updated = await billingApi.changePlan('workspace_1', { planId: 'plan_2' });

      expect(updated).toEqual(mockUpdated);
    });
  });

  describe('cancelSubscription', () => {
    it('cancels subscription', async () => {
      const mockCanceled = { id: 'sub_123', status: 'CANCELED' as const };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockCanceled));

      const canceled = await billingApi.cancelSubscription('workspace_1', {
        atPeriodEnd: false,
      });

      expect(canceled).toEqual(mockCanceled);
    });
  });

  describe('reactivateSubscription', () => {
    it('reactivates subscription', async () => {
      const mockReactivated = { id: 'sub_123', status: 'ACTIVE' as const };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockReactivated));

      const reactivated = await billingApi.reactivateSubscription('workspace_1');

      expect(reactivated).toEqual(mockReactivated);
    });
  });

  describe('getCreditBalance', () => {
    it('fetches credit balance', async () => {
      const mockBalance = { balance: 5000, creditsUsed: 1000, creditsGranted: 6000 };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockBalance));

      const balance = await billingApi.getCreditBalance('workspace_1');

      expect(balance).toEqual(mockBalance);
    });
  });

  describe('listCreditLedger', () => {
    it('fetches credit ledger entries', async () => {
      const mockEntries = [
        { id: '1', type: 'GRANT' as const, amount: 5000 },
        { id: '2', type: 'DEDUCTION' as const, amount: -250 },
      ];

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockEntries));

      const entries = await billingApi.listCreditLedger('workspace_1');

      expect(entries).toHaveLength(2);
    });
  });

  describe('getUsageSummary', () => {
    it('fetches usage summary', async () => {
      const mockSummary = {
        text_generation: { quantity: 100, creditsCost: 250 },
        image_generation: { quantity: 5, creditsCost: 500 },
      };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockSummary));

      const summary = await billingApi.getUsageSummary('workspace_1');

      expect(summary).toEqual(mockSummary);
    });
  });

  describe('listPaymentMethods', () => {
    it('fetches payment methods', async () => {
      const mockMethods = [
        {
          id: 'pm_1',
          type: 'CARD' as const,
          brand: 'visa',
          last4: '4242',
        },
      ];

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockMethods));

      const methods = await billingApi.listPaymentMethods('workspace_1');

      expect(methods).toHaveLength(1);
    });
  });

  describe('listInvoices', () => {
    it('fetches invoices', async () => {
      const mockInvoices = [
        {
          id: 'inv_1',
          status: 'PAID' as const,
          amountPaidCents: 10000,
        },
      ];

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockInvoices));

      const invoices = await billingApi.listInvoices('workspace_1');

      expect(invoices).toHaveLength(1);
    });
  });

  describe('createBillingPortalSession', () => {
    it('creates billing portal session', async () => {
      const mockSession = { url: 'https://billing.stripe.com/session' };

      global.fetch = vi.fn().mockResolvedValue(createSuccessResponse(mockSession));

      const session = await billingApi.createBillingPortalSession('workspace_1', {
        returnUrl: 'https://example.com/dashboard',
      });

      expect(session).toEqual(mockSession);
    });
  });
});
