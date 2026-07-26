import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as billingApi from '../billing';
import * as authApi from '../auth';

vi.mock('../auth');

describe('billing API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPlans', () => {
    it('fetches active plans', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: '1', name: 'Basic', priceCents: 9999 },
          { id: '2', name: 'Pro', priceCents: 19999 },
        ]),
      });

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
        status: 'ACTIVE',
        planId: 'plan_1',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSubscription),
      });

      global.fetch = mockFetch;

      const subscription = await billingApi.getSubscription();

      expect(subscription).toEqual(mockSubscription);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/subscription'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('createCheckoutSession', () => {
    it('creates checkout session', async () => {
      const mockSession = { url: 'https://checkout.stripe.com/session' };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSession),
      });

      global.fetch = mockFetch;

      const session = await billingApi.createCheckoutSession({
        planId: 'plan_1',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(session).toEqual(mockSession);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/checkout'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('planId'),
        })
      );
    });
  });

  describe('changePlan', () => {
    it('changes subscription plan', async () => {
      const mockUpdated = { id: 'sub_123', planId: 'plan_2' };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockUpdated),
      });

      global.fetch = mockFetch;

      const updated = await billingApi.changePlan({ planId: 'plan_2' });

      expect(updated).toEqual(mockUpdated);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/change-plan'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('cancelSubscription', () => {
    it('cancels subscription', async () => {
      const mockCanceled = { id: 'sub_123', status: 'CANCELED' };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockCanceled),
      });

      global.fetch = mockFetch;

      const canceled = await billingApi.cancelSubscription({
        atPeriodEnd: false,
      });

      expect(canceled).toEqual(mockCanceled);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/cancel'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('reactivateSubscription', () => {
    it('reactivates subscription', async () => {
      const mockReactivated = { id: 'sub_123', cancelAtPeriodEnd: false };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockReactivated),
      });

      global.fetch = mockFetch;

      const reactivated = await billingApi.reactivateSubscription();

      expect(reactivated).toEqual(mockReactivated);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/reactivate'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('getCreditBalance', () => {
    it('fetches credit balance', async () => {
      const mockBalance = { balance: 5000 };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockBalance),
      });

      global.fetch = mockFetch;

      const balance = await billingApi.getCreditBalance();

      expect(balance).toEqual(mockBalance);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/credits'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('listCreditLedger', () => {
    it('fetches credit ledger entries', async () => {
      const mockEntries = [
        { id: '1', type: 'GRANT', amount: 5000 },
        { id: '2', type: 'DEDUCTION', amount: -250 },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockEntries),
      });

      global.fetch = mockFetch;

      const entries = await billingApi.listCreditLedger();

      expect(entries).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/credit-ledger'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('getUsageSummary', () => {
    it('fetches usage summary', async () => {
      const mockSummary = {
        text_generation: { quantity: 100, creditsCost: 250 },
        image_generation: { quantity: 5, creditsCost: 500 },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSummary),
      });

      global.fetch = mockFetch;

      const summary = await billingApi.getUsageSummary();

      expect(summary).toEqual(mockSummary);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/usage'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('listPaymentMethods', () => {
    it('fetches payment methods', async () => {
      const mockMethods = [
        {
          id: 'pm_1',
          type: 'CARD',
          brand: 'visa',
          last4: '4242',
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockMethods),
      });

      global.fetch = mockFetch;

      const methods = await billingApi.listPaymentMethods();

      expect(methods).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/payment-methods'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('listInvoices', () => {
    it('fetches invoices', async () => {
      const mockInvoices = [
        {
          id: 'inv_1',
          status: 'PAID',
          amountPaidCents: 10000,
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockInvoices),
      });

      global.fetch = mockFetch;

      const invoices = await billingApi.listInvoices();

      expect(invoices).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/invoices'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('createBillingPortalSession', () => {
    it('creates billing portal session', async () => {
      const mockSession = { url: 'https://billing.stripe.com/session' };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSession),
      });

      global.fetch = mockFetch;

      const session = await billingApi.createBillingPortalSession({
        returnUrl: 'https://example.com/dashboard',
      });

      expect(session).toEqual(mockSession);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/billing/billing-portal'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
