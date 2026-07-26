import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '@synora/database';
import { initializeApp } from '../../index';
import * as billingModule from '../../billing/index.js';
import type { Express } from 'express';

describe('billing webhook routes', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let workspaceId: string;
  let planId: string;
  let app: Express;

  beforeAll(async () => {
    const initialized = await initializeApp();
    app = initialized.app;
  });

  beforeEach(async () => {
    // Create test workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-${Date.now()}`,
      },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    // Create credits for workspace
    await prisma.workspaceCredits.create({
      data: {
        workspaceId,
        balance: 10000,
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

    // Create subscription for workspace
    await prisma.subscription.create({
      data: {
        workspaceId,
        planId,
        status: 'ACTIVE',
        externalSubscriptionId: 'test_sub_123',
      },
    });
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
      await prisma.processedWebhookEvent.deleteMany({
        where: { externalEventId: { startsWith: 'test_' } },
      });
      await prisma.creditLedgerEntry.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.usageRecord.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.invoice.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.subscription.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.workspaceCredits.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: testWorkspaceIds } },
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

  describe('POST /api/billing/webhook', () => {
    it('processes invoice.paid webhook event', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_invoice_paid',
          type: 'invoice.paid',
          data: {
            id: 'test_inv_paid_123',
            subscription: 'test_sub_123',
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

      const creditsBefore = await prisma.workspaceCredits.findUnique({
        where: { workspaceId },
      });

      const res = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'test_signature');

      expect(res.status).toBe(200);

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

    it('processes subscription.updated webhook event', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_sub_updated',
          type: 'customer.subscription.updated',
          data: {
            id: 'test_sub_123',
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

      const res = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'test_signature');

      expect(res.status).toBe(200);

      const subscription = await prisma.subscription.findFirst({
        where: { externalSubscriptionId: 'test_sub_123' },
      });
      expect(subscription?.status).toBe('PAST_DUE');
    });

    it('deduplicates webhook events', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_dedup',
          type: 'invoice.paid',
          data: {
            id: 'test_inv_dedup_123',
            subscription: 'test_sub_123',
            amount_paid: 5000,
          },
        }),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      // First call
      const res1 = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'test_signature');

      expect(res1.status).toBe(200);

      // Second call (should deduplicate)
      const res2 = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'test_signature');

      expect(res2.status).toBe(200);

      const events = await prisma.processedWebhookEvent.findMany({
        where: { externalEventId: 'test_evt_dedup' },
      });
      expect(events).toHaveLength(1);
    });

    it('handles invalid webhook signature', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockRejectedValue(new billingModule.BillingProviderError('Invalid signature')),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const res = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'invalid_signature');

      expect(res.status).toBe(503);
    });

    it('processes payment_method.attached webhook event', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_pm_attach',
          type: 'payment_method.attached',
          data: {
            id: 'test_pm_attach_123',
            customer: 'cus_test_123',
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
        where: { id: (await prisma.subscription.findFirst({ where: { workspaceId } }))!.id },
        data: { externalCustomerId: 'cus_test_123' },
      });

      const res = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'test_signature');

      expect(res.status).toBe(200);

      const paymentMethod = await prisma.paymentMethod.findFirst({
        where: { externalPaymentMethodId: 'test_pm_attach_123' },
      });
      expect(paymentMethod).toBeDefined();
    });

    it('processes checkout.session.completed webhook event', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockReturnValue(true),
        verifyAndParseWebhookEvent: vi.fn().mockResolvedValue({
          id: 'test_evt_checkout',
          type: 'checkout.session.completed',
          data: {
            subscription: 'test_sub_checkout_123',
            customer: 'cus_checkout_123',
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
        where: { id: (await prisma.subscription.findFirst({ where: { workspaceId } }))!.id },
        data: { externalSubscriptionId: 'test_sub_checkout_123' },
      });

      const res = await request(app)
        .post('/api/billing/webhook')
        .send({ raw: 'webhook_payload' })
        .set('stripe-signature', 'test_signature');

      expect(res.status).toBe(200);

      const subscription = await prisma.subscription.findFirst({
        where: { externalSubscriptionId: 'test_sub_checkout_123' },
      });
      expect(subscription?.status).toBe('ACTIVE');
    });
  });
});
