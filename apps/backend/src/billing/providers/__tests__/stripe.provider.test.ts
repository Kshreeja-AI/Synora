import { describe, it, expect, beforeEach, vi } from 'vitest';
import Stripe from 'stripe';
import { StripeProvider } from '../stripe.provider';
import { BillingProviderError } from '../../types.js';
import { PlaceholderSecretSource } from '../../../secrets/sources/placeholderSource.js';

vi.mock('stripe');

describe('StripeProvider', () => {
  let mockStripe: any;
  let provider: StripeProvider;

  beforeEach(() => {
    mockStripe = {
      customers: {
        create: vi.fn(),
      },
      checkout: {
        sessions: {
          create: vi.fn(),
        },
      },
      billingPortal: {
        sessions: {
          create: vi.fn(),
        },
      },
      subscriptions: {
        retrieve: vi.fn(),
        update: vi.fn(),
        cancel: vi.fn(),
      },
      paymentMethods: {
        list: vi.fn(),
        detach: vi.fn(),
      },
      webhooks: {
        constructEvent: vi.fn(),
      },
    };

    vi.mocked(Stripe).mockImplementation(() => mockStripe);

    provider = new StripeProvider({
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_test_123',
    });
  });

  describe('isConfigured', () => {
    it('returns true when secret key is configured', () => {
      const result = provider.isConfigured();
      expect(result).toBe(true);
    });

    it('returns false when secret key is placeholder', () => {
      const placeholder = PlaceholderSecretSource.generate('STRIPE_SECRET_KEY');
      const unconfiguredProvider = new StripeProvider({
        secretKey: placeholder,
        webhookSecret: 'whsec_test',
      });
      const result = unconfiguredProvider.isConfigured();
      expect(result).toBe(false);
    });

    it('returns false when secret key is empty', () => {
      const emptyProvider = new StripeProvider({
        secretKey: '',
        webhookSecret: 'whsec_test',
      });
      const result = emptyProvider.isConfigured();
      expect(result).toBe(false);
    });
  });

  describe('createCustomer', () => {
    it('creates a customer and returns customer ID', async () => {
      mockStripe.customers.create.mockResolvedValue({
        id: 'cus_test_123',
      });

      const result = await provider.createCustomer({
        workspaceId: 'ws_123',
        email: 'test@example.com',
      });

      expect(result).toBe('cus_test_123');
      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: { workspaceId: 'ws_123' },
      });
    });

    it('throws BillingProviderError on customer creation failure', async () => {
      mockStripe.customers.create.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.createCustomer({
          workspaceId: 'ws_123',
          email: 'test@example.com',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('createCheckoutSession', () => {
    it('creates a checkout session and returns URL', async () => {
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/test',
      });

      const result = await provider.createCheckoutSession({
        customerId: 'cus_test_123',
        priceId: 'price_test_123',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.url).toBe('https://checkout.stripe.com/test');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_test_123',
        payment_method_types: ['card'],
        line_items: [{ price: 'price_test_123', quantity: 1 }],
        mode: 'subscription',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      });
    });

    it('throws error when no checkout URL returned', async () => {
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: null,
      });

      await expect(
        provider.createCheckoutSession({
          customerId: 'cus_test_123',
          priceId: 'price_test_123',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow(BillingProviderError);
    });

    it('throws BillingProviderError on session creation failure', async () => {
      mockStripe.checkout.sessions.create.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.createCheckoutSession({
          customerId: 'cus_test_123',
          priceId: 'price_test_123',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('createSetupSession', () => {
    it('creates a setup session and returns URL', async () => {
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/setup',
      });

      const result = await provider.createSetupSession({
        customerId: 'cus_test_123',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.url).toBe('https://checkout.stripe.com/setup');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_test_123',
        payment_method_types: ['card'],
        mode: 'setup',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      });
    });

    it('throws error when no setup URL returned', async () => {
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: null,
      });

      await expect(
        provider.createSetupSession({
          customerId: 'cus_test_123',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('createBillingPortalSession', () => {
    it('creates a billing portal session and returns URL', async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/session',
      });

      const result = await provider.createBillingPortalSession({
        customerId: 'cus_test_123',
        returnUrl: 'https://example.com/dashboard',
      });

      expect(result.url).toBe('https://billing.stripe.com/session');
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_test_123',
        return_url: 'https://example.com/dashboard',
      });
    });

    it('throws BillingProviderError on session creation failure', async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.createBillingPortalSession({
          customerId: 'cus_test_123',
          returnUrl: 'https://example.com/dashboard',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('updateSubscription', () => {
    it('updates subscription price', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        items: {
          data: [{ id: 'si_test_123' }],
        },
      });
      mockStripe.subscriptions.update.mockResolvedValue({});

      await provider.updateSubscription({
        subscriptionId: 'sub_test_123',
        priceId: 'price_new_123',
      });

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_test_123');
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_test_123', {
        items: [{ id: 'si_test_123', price: 'price_new_123' }],
      });
    });

    it('throws error when subscription has no items', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        items: {
          data: [],
        },
      });

      await expect(
        provider.updateSubscription({
          subscriptionId: 'sub_test_123',
          priceId: 'price_new_123',
        })
      ).rejects.toThrow(BillingProviderError);
    });

    it('throws BillingProviderError on retrieval failure', async () => {
      mockStripe.subscriptions.retrieve.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.updateSubscription({
          subscriptionId: 'sub_test_123',
          priceId: 'price_new_123',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('cancelSubscription', () => {
    it('cancels subscription immediately', async () => {
      mockStripe.subscriptions.cancel.mockResolvedValue({});

      await provider.cancelSubscription({
        subscriptionId: 'sub_test_123',
        atPeriodEnd: false,
      });

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_test_123');
    });

    it('cancels subscription at period end', async () => {
      mockStripe.subscriptions.update.mockResolvedValue({});

      await provider.cancelSubscription({
        subscriptionId: 'sub_test_123',
        atPeriodEnd: true,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_test_123', {
        cancel_at_period_end: true,
      });
    });

    it('throws BillingProviderError on cancel failure', async () => {
      mockStripe.subscriptions.cancel.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.cancelSubscription({
          subscriptionId: 'sub_test_123',
          atPeriodEnd: false,
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('listPaymentMethods', () => {
    it('lists payment methods for customer', async () => {
      mockStripe.paymentMethods.list.mockResolvedValue({
        data: [
          {
            id: 'pm_test_123',
            card: {
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2025,
            },
          },
        ],
      });

      const result = await provider.listPaymentMethods({
        customerId: 'cus_test_123',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('pm_test_123');
      expect(result[0].brand).toBe('visa');
      expect(result[0].last4).toBe('4242');
      expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
        customer: 'cus_test_123',
        type: 'card',
      });
    });

    it('returns empty array when no payment methods', async () => {
      mockStripe.paymentMethods.list.mockResolvedValue({
        data: [],
      });

      const result = await provider.listPaymentMethods({
        customerId: 'cus_test_123',
      });

      expect(result).toHaveLength(0);
    });

    it('throws BillingProviderError on list failure', async () => {
      mockStripe.paymentMethods.list.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.listPaymentMethods({
          customerId: 'cus_test_123',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('removePaymentMethod', () => {
    it('detaches payment method', async () => {
      mockStripe.paymentMethods.detach.mockResolvedValue({});

      await provider.removePaymentMethod({
        paymentMethodId: 'pm_test_123',
      });

      expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith('pm_test_123');
    });

    it('throws BillingProviderError on detach failure', async () => {
      mockStripe.paymentMethods.detach.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.removePaymentMethod({
          paymentMethodId: 'pm_test_123',
        })
      ).rejects.toThrow(BillingProviderError);
    });
  });

  describe('verifyAndParseWebhookEvent', () => {
    it('verifies and parses webhook event', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'invoice.paid',
        data: { object: {} },
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(event);

      const result = await provider.verifyAndParseWebhookEvent(
        Buffer.from('test'),
        'sig_test'
      );

      expect(result.id).toBe('evt_test_123');
      expect(result.type).toBe('invoice.paid');
    });

    it('throws BillingProviderError on invalid signature', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        const error = new Error('Invalid signature');
        (error as any).code = 'ERR_INVALID_SIGNATURE';
        throw error;
      });

      await expect(
        provider.verifyAndParseWebhookEvent(Buffer.from('test'), 'bad_sig')
      ).rejects.toThrow(BillingProviderError);
    });
  });
});
