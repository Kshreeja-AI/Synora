import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { handleBillingWebhook } from '../webhook.service';
import { ServiceUnavailableException } from '@synora/shared';
import * as billingModule from '../../billing/index.js';

describe('webhook.service', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let workspaceId: string;
  let planId: string;
  let subscriptionId: string;
  let ownerId: string;

  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(async () => {
    // Create test workspace
    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `test-${Date.now()}` },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    // Create credits for workspace
    await prisma.workspaceCredits.create({
      data: { workspaceId, balance: 10000 },
    });

    // Create test user (owner)
    const owner = await prisma.user.create({
      data: {
        email: `owner-${Date.now()}@test.com`,
        password: 'hashed',
      },
    });
    ownerId = owner.id;

    // Create workspace member (owner role)
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: ownerId,
        role: 'OWNER',
      },
    });

    // Create test plan
    const plan = await prisma.plan.create({
      data: {
        key: `test-plan-${Date.now()}`,
        name: 'Test Plan',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        status: 'ACTIVE',
      },
    });
    planId = plan.id;
    testPlanIds.push(planId);

    // Create subscription
    const subscription = await prisma.subscription.create({
      data: {
        workspaceId,
        planId,
        status: 'ACTIVE',
      },
    });
    subscriptionId = subscription.id;
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
      await prisma.processedWebhookEvent.deleteMany({
        where: { externalEventId: { startsWith: 'test_' } },
      });
      await prisma.paymentMethod.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.invoice.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.creditLedgerEntry.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.usageRecord.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.subscription.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.workspaceCredits.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: testWorkspaceIds } },
      });
      await prisma.user.deleteMany({
        where: { id: ownerId },
      });
      testWorkspaceIds.length = 0;
    }

    if (testPlanIds.length > 0) {
      await prisma.plan.deleteMany({
        where: { id: { in: testPlanIds } },
      });
      testPlanIds.length = 0;
    }
  });

  describe('handleBillingWebhook', () => {
    it('deduplicates webhook events', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_123',
          type: 'invoice.paid',
          data: {
            id: 'test_inv_123',
            subscription: 'test_sub_123',
            amount_paid: 10000,
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const rawBody = Buffer.from('test');
      const signature = 'test_signature';

      // First call should process
      await handleBillingWebhook(rawBody, signature);

      const processed1 = await prisma.processedWebhookEvent.findUnique({
        where: {
          provider_externalEventId: {
            provider: 'stripe',
            externalEventId: 'test_evt_123',
          },
        },
      });
      expect(processed1).toBeDefined();

      // Second call should be deduplicated
      await handleBillingWebhook(rawBody, signature);

      const allProcessed = await prisma.processedWebhookEvent.findMany({
        where: {
          externalEventId: 'test_evt_123',
        },
      });
      expect(allProcessed).toHaveLength(1);
    });

    it('throws ServiceUnavailableException on verification error', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi
          .fn()
          .mockRejectedValue(new billingModule.BillingProviderError('INVALID_SIGNATURE', 'Invalid signature')),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(handleBillingWebhook(Buffer.from('test'), 'invalid_sig')).rejects.toThrow(
        ServiceUnavailableException
      );
    });

    it('throws ServiceUnavailableException when provider not configured', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(false),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(handleBillingWebhook(Buffer.from('test'), 'sig')).rejects.toThrow(
        ServiceUnavailableException
      );
    });

    it('handles unrecognized event types silently', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_unknown',
          type: 'unknown.event.type',
          data: {},
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(handleBillingWebhook(Buffer.from('test'), 'sig')).resolves.not.toThrow();

      const processed = await prisma.processedWebhookEvent.findUnique({
        where: {
          provider_externalEventId: {
            provider: 'stripe',
            externalEventId: 'test_evt_unknown',
          },
        },
      });
      expect(processed).toBeDefined();
    });
  });

  describe('handleCheckoutCompleted', () => {
    it('updates subscription on checkout completed', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_checkout',
          type: 'checkout.session.completed',
          data: {
            subscription: 'test_sub_checkout',
            customer: 'cus_test_123',
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { externalSubscriptionId: 'test_sub_checkout' },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const updated = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });
      expect(updated?.externalSubscriptionId).toBe('test_sub_checkout');
      expect(updated?.status).toBe('ACTIVE');
    });
  });

  describe('handleSubscriptionUpdated', () => {
    it('updates subscription status on subscription.updated event', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_sub_update',
          type: 'customer.subscription.updated',
          data: {
            id: 'test_sub_update_123',
            status: 'past_due',
            current_period_start: now,
            current_period_end: now + 2592000,
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { externalSubscriptionId: 'test_sub_update_123' },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const updated = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });
      expect(updated?.status).toBe('PAST_DUE');
    });
  });

  describe('handleSubscriptionDeleted', () => {
    it('reverts to default plan on subscription deleted', async () => {
      const defaultPlan = await prisma.plan.create({
        data: {
          key: `default-plan-${Date.now()}`,
          name: 'Default Plan',
          interval: 'MONTH',
          priceCents: 0,
          isDefault: true,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(defaultPlan.id);

      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_sub_delete',
          type: 'customer.subscription.deleted',
          data: {
            id: 'test_sub_delete_123',
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { externalSubscriptionId: 'test_sub_delete_123' },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const updated = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });
      expect(updated?.planId).toBe(defaultPlan.id);
      expect(updated?.externalSubscriptionId).toBeNull();
    });
  });

  describe('handleInvoicePaid', () => {
    it('creates invoice and grants credits on invoice.paid', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_inv_paid',
          type: 'invoice.paid',
          data: {
            id: 'test_inv_paid_123',
            subscription: 'test_sub_for_inv_123',
            amount_paid: 10000,
            hosted_invoice_url: 'https://invoice.stripe.com/i/test',
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { externalSubscriptionId: 'test_sub_for_inv_123' },
      });

      const creditsBefore = await prisma.workspaceCredits.findUnique({
        where: { workspaceId },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const invoice = await prisma.invoice.findFirst({
        where: { externalInvoiceId: 'test_inv_paid_123' },
      });
      expect(invoice?.status).toBe('PAID');
      expect(invoice?.amountPaidCents).toBe(10000);

      const creditsAfter = await prisma.workspaceCredits.findUnique({
        where: { workspaceId },
      });
      expect(creditsAfter?.balance).toBe((creditsBefore?.balance || 0) + 5000);
    });
  });

  describe('handleInvoicePaymentFailed', () => {
    it('marks subscription past due on invoice.payment_failed', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_inv_fail',
          type: 'invoice.payment_failed',
          data: {
            id: 'test_inv_fail_123',
            subscription: 'test_sub_for_fail_123',
            amount_due: 10000,
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { externalSubscriptionId: 'test_sub_for_fail_123' },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const updated = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });
      expect(updated?.status).toBe('PAST_DUE');

      const invoice = await prisma.invoice.findFirst({
        where: { externalInvoiceId: 'test_inv_fail_123' },
      });
      expect(invoice?.status).toBe('OPEN');
    });
  });

  describe('handlePaymentMethodAttached', () => {
    it('creates payment method on payment_method.attached', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_pm_attach',
          type: 'payment_method.attached',
          data: {
            id: 'test_pm_123',
            customer: 'cus_test_for_pm',
            type: 'card',
            card: {
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2025,
            },
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { externalCustomerId: 'cus_test_for_pm' },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const paymentMethod = await prisma.paymentMethod.findFirst({
        where: { externalPaymentMethodId: 'test_pm_123' },
      });
      expect(paymentMethod).toBeDefined();
      expect(paymentMethod?.brand).toBe('visa');
      expect(paymentMethod?.last4).toBe('4242');
      expect(paymentMethod?.expiryMonth).toBe(12);
      expect(paymentMethod?.expiryYear).toBe(2025);
    });
  });

  describe('handlePaymentMethodDetached', () => {
    it('deletes payment method on payment_method.detached', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_pm_detach',
          type: 'payment_method.detached',
          data: {
            id: 'test_pm_detach_123',
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      // Create a payment method first
      await prisma.paymentMethod.create({
        data: {
          subscriptionId,
          workspaceId,
          provider: 'stripe',
          externalPaymentMethodId: 'test_pm_detach_123',
          type: 'CARD',
          isDefault: true,
        },
      });

      await handleBillingWebhook(Buffer.from('test'), 'sig');

      const deleted = await prisma.paymentMethod.findFirst({
        where: { externalPaymentMethodId: 'test_pm_detach_123' },
      });
      expect(deleted).toBeNull();
    });
  });
});
