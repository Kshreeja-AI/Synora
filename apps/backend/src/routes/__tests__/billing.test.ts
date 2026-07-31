import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '@synora/database';
import { initializeApp } from '../../index';
import { issueTokens } from '../../services/token.service';
import * as billingModule from '../../billing/index.js';
import type { Express } from 'express';

describe('billing routes', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let userId: string;
  let workspaceId: string;
  let planId: string;
  let token: string;
  let app: Express;

  beforeAll(async () => {
    const initialized = await initializeApp();
    app = initialized.app;
  });

  beforeEach(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.com`,
        password: 'hashed',
      },
    });
    userId = user.id;

    // Create test workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-${Date.now()}`,
      },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    // Add user to workspace as owner
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId,
        role: 'OWNER',
      },
    });

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
      },
    });

    // Generate token
    const authTokens = await issueTokens({
      userId,
      email: user.email,
      role: user.role,
    });
    token = authTokens.accessToken;
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
        where: { id: userId },
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

  describe('GET /api/workspaces/:id/billing/subscription', () => {
    it('returns current subscription', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/billing/subscription`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('workspaceId', workspaceId);
      expect(res.body).toHaveProperty('planId', planId);
      expect(res.body).toHaveProperty('status', 'ACTIVE');
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get(`/api/workspaces/${workspaceId}/billing/subscription`);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/workspaces/:id/billing/credits', () => {
    it('returns credit balance', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/billing/credits`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('balance');
      expect(res.body.balance).toBe(10000);
    });
  });

  describe('GET /api/workspaces/:id/billing/credits/ledger', () => {
    it('returns credit ledger entries', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/billing/credits/ledger`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/workspaces/:id/billing/usage', () => {
    it('returns usage summary', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/billing/usage`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
    });
  });

  describe('GET /api/workspaces/:id/billing/payment-methods', () => {
    it('returns empty payment methods', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/billing/payment-methods`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/workspaces/:id/billing/invoices', () => {
    it('returns empty invoices list', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/billing/invoices`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/workspaces/:id/billing/checkout', () => {
    it('creates checkout session', async () => {
      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn().mockResolvedValue('cus_test_123'),
        createCheckoutSession: vi.fn().mockResolvedValue({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/test',
        }),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn(),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/billing/checkout`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          planId,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('url');
    });
  });

  describe('PATCH /api/workspaces/:id/billing/subscription', () => {
    it('changes subscription plan', async () => {
      const newPlan = await prisma.plan.create({
        data: {
          key: `new-plan-${Date.now()}`,
          name: 'New Plan',
          interval: 'MONTH',
          priceCents: 19999,
          creditsPerInterval: 10000,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(newPlan.id);

      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalSubscriptionId: 'sub_test_123' },
      });

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

      const res = await request(app)
        .patch(`/api/workspaces/${workspaceId}/billing/subscription`)
        .set('Authorization', `Bearer ${token}`)
        .send({ planId: newPlan.id });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('planId', newPlan.id);
    });
  });

  describe('POST /api/workspaces/:id/billing/subscription/cancel', () => {
    it('cancels subscription', async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalSubscriptionId: 'sub_test_123' },
      });

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

      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/billing/subscription/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ atPeriodEnd: false });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'CANCELED');
    });
  });

  describe('POST /api/workspaces/:id/billing/subscription/reactivate', () => {
    it('reactivates subscription', async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { cancelAtPeriodEnd: true },
      });

      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/billing/subscription/reactivate`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('cancelAtPeriodEnd', false);
    });
  });

  describe('POST /api/workspaces/:id/billing/portal', () => {
    it('creates billing portal session', async () => {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { externalCustomerId: 'cus_test_123' },
      });

      const mockProvider = {
        isConfigured: vi.fn().mockResolvedValue(true),
        verifyAndParseWebhookEvent: vi.fn(),
        createCustomer: vi.fn(),
        createCheckoutSession: vi.fn(),
        updateSubscription: vi.fn(),
        cancelSubscription: vi.fn(),
        createBillingPortalSession: vi.fn().mockResolvedValue({
          url: 'https://billing.stripe.com/session',
        }),
      };

      vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/billing/portal`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnUrl: 'https://example.com/dashboard' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('url');
    });
  });
});
