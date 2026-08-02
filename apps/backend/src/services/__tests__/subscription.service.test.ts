import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import {
  getSubscriptionForWorkspace,
  ensureBillingCustomer,
  createCheckoutSession,
  changePlan,
  cancelSubscription,
  reactivateSubscription,
  createBillingPortalSession,
} from '../subscription.service';
import { NotFoundException, ServiceUnavailableException } from '@synora/shared';
import * as billingModule from '../../billing/index.js';

describe('subscription.service', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let workspaceId: string;
  let planId: string;
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
        providerPriceIds: { stripe: 'price_test_123' },
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
      },
    });
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
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

  describe('getSubscriptionForWorkspace', () => {
    it('returns subscription with plan', async () => {
      const subscription = await getSubscriptionForWorkspace('user-id', workspaceId);
      expect(subscription).toBeDefined();
      expect(subscription.workspaceId).toBe(workspaceId);
      expect(subscription.planId).toBe(planId);
      expect(subscription.plan).toBeDefined();
    });

    it('throws NotFoundException for non-existent workspace', async () => {
      await expect(getSubscriptionForWorkspace('user-id', 'nonexistent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('ensureBillingCustomer', () => {
    it('returns existing customerId when already set', async () => {
      const customerId = 'cus_existing';
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalCustomerId: customerId },
      });

      const result = await ensureBillingCustomer(workspaceId);
      expect(result).toBe(customerId);
    });

    it('creates new customer when not set', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn().mockResolvedValue('cus_new_123'),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const result = await ensureBillingCustomer(workspaceId);
      expect(result).toBe('cus_new_123');

      const updated = await prisma.subscription.findUnique({
        where: { workspaceId },
      });
      expect(updated?.externalCustomerId).toBe('cus_new_123');
      expect(updated?.provider).toBe('stripe');
    });

    it('throws ServiceUnavailableException on provider error', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn().mockRejectedValue(new billingModule.BillingProviderError('PROVIDER_ERROR', 'Provider down')),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(ensureBillingCustomer(workspaceId)).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws NotFoundException for non-existent subscription', async () => {
      await expect(ensureBillingCustomer('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createCheckoutSession', () => {
    beforeEach(async () => {
      // Ensure billing customer is set
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalCustomerId: 'cus_test_123' },
      });
    });

    it('creates checkout session and records audit event', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn().mockResolvedValue({
          url: 'https://checkout.stripe.com/test',
        }),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const result = await createCheckoutSession('user-id', workspaceId, {
        planId,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.url).toBe('https://checkout.stripe.com/test');
      expect(mockProvider.createCheckoutSession).toHaveBeenCalled();

      const auditLogs = await prisma.auditLog.findMany({
        where: { workspaceId, action: 'checkout_initiated' },
      });
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('throws NotFoundException for non-existent plan', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(
        createCheckoutSession('user-id', workspaceId, {
          planId: 'nonexistent',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ServiceUnavailableException on provider error', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn().mockRejectedValue(new billingModule.BillingProviderError('PROVIDER_ERROR', 'Provider down')),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(
        createCheckoutSession('user-id', workspaceId, {
          planId,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when plan has no Stripe price ID configured', async () => {
      const unpricedPlan = await prisma.plan.create({
        data: {
          key: `unpriced-plan-${Date.now()}`,
          name: 'Unpriced Plan',
          interval: 'MONTH',
          priceCents: 4999,
          creditsPerInterval: 1000,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(unpricedPlan.id);

      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(
        createCheckoutSession('user-id', workspaceId, {
          planId: unpricedPlan.id,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow(/no Stripe price ID configured/);

      expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('changePlan', () => {
    beforeEach(async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalSubscriptionId: 'sub_test_123' },
      });
    });

    it('changes plan and creates notification', async () => {
      const newPlan = await prisma.plan.create({
        data: {
          key: `new-plan-${Date.now()}`,
          name: 'New Plan',
          interval: 'MONTH',
          priceCents: 19999,
          creditsPerInterval: 10000,
          status: 'ACTIVE',
          providerPriceIds: { stripe: 'price_new_test_456' },
        },
      });
      testPlanIds.push(newPlan.id);

      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn().mockResolvedValue(undefined),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const result = await changePlan('user-id', workspaceId, {
        planId: newPlan.id,
      });

      expect(result.planId).toBe(newPlan.id);
      expect(mockProvider.updateSubscription).toHaveBeenCalled();

      const auditLogs = await prisma.auditLog.findMany({
        where: { workspaceId, action: 'plan_changed' },
      });
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('throws NotFoundException when plan not found', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(
        changePlan('user-id', workspaceId, { planId: 'nonexistent' })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no active subscription', async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalSubscriptionId: null },
      });

      await expect(
        changePlan('user-id', workspaceId, { planId })
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ServiceUnavailableException when target plan has no Stripe price ID configured', async () => {
      const unpricedPlan = await prisma.plan.create({
        data: {
          key: `unpriced-plan-${Date.now()}`,
          name: 'Unpriced Plan',
          interval: 'MONTH',
          priceCents: 4999,
          creditsPerInterval: 1000,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(unpricedPlan.id);

      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(
        changePlan('user-id', workspaceId, { planId: unpricedPlan.id })
      ).rejects.toThrow(/no Stripe price ID configured/);

      expect(mockProvider.updateSubscription).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    beforeEach(async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalSubscriptionId: 'sub_test_123' },
      });
    });

    it('cancels subscription immediately', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn().mockResolvedValue(undefined),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const result = await cancelSubscription('user-id', workspaceId, {
        atPeriodEnd: false,
      });

      expect(result.status).toBe('CANCELED');
      expect(result.cancelAtPeriodEnd).toBe(false);

      const auditLogs = await prisma.auditLog.findMany({
        where: { workspaceId, action: 'subscription_canceled' },
      });
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('cancels subscription at period end', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn().mockResolvedValue(undefined),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const result = await cancelSubscription('user-id', workspaceId, {
        atPeriodEnd: true,
      });

      expect(result.status).toBe('ACTIVE');
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it('throws NotFoundException when no active subscription', async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalSubscriptionId: null },
      });

      await expect(
        cancelSubscription('user-id', workspaceId, { atPeriodEnd: false })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reactivateSubscription', () => {
    it('reactivates subscription scheduled for cancellation', async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { cancelAtPeriodEnd: true },
      });

      const result = await reactivateSubscription('user-id', workspaceId);

      expect(result.cancelAtPeriodEnd).toBe(false);

      const auditLogs = await prisma.auditLog.findMany({
        where: { workspaceId, action: 'subscription_reactivated' },
      });
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('throws error when not scheduled for cancellation', async () => {
      await expect(reactivateSubscription('user-id', workspaceId)).rejects.toThrow(
        'Subscription not scheduled for cancellation'
      );
    });
  });

  describe('createBillingPortalSession', () => {
    beforeEach(async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalCustomerId: 'cus_test_123' },
      });
    });

    it('creates billing portal session', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn().mockResolvedValue({
          url: 'https://billing.stripe.com/session/test',
        }),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const result = await createBillingPortalSession(
        'user-id',
        workspaceId,
        'https://example.com/return'
      );

      expect(result.url).toBeDefined();
      expect(mockProvider.createBillingPortalSession).toHaveBeenCalledWith({
        customerId: 'cus_test_123',
        returnUrl: 'https://example.com/return',
      });
    });

    it('throws ServiceUnavailableException on provider error', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn().mockRejectedValue(new billingModule.BillingProviderError('PROVIDER_ERROR', 'Provider down')),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      await expect(
        createBillingPortalSession('user-id', workspaceId, 'https://example.com/return')
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
