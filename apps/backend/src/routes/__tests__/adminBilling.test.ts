import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { prisma } from '@synora/database';
import { initializeApp } from '../../index';
import { issueTokens } from '../../services/token.service';
import type { Express } from 'express';

describe('admin billing routes', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let adminUserId: string;
  let regularUserId: string;
  let workspaceId: string;
  let adminToken: string;
  let regularToken: string;
  let app: Express;

  beforeAll(async () => {
    const initialized = await initializeApp();
    app = initialized.app;
  });

  beforeEach(async () => {
    // Create admin user
    const adminUserCreated = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@test.com`,
        password: 'hashed',
        role: 'ADMIN',
      },
    });
    adminUserId = adminUserCreated.id;

    // Create regular user
    const regularUserCreated = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.com`,
        password: 'hashed',
      },
    });
    regularUserId = regularUserCreated.id;

    // Create test workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-${Date.now()}`,
      },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    // Add admin user to workspace
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: adminUserId,
        role: 'OWNER',
      },
    });

    // Add regular user to workspace
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: regularUserId,
        role: 'MEMBER',
      },
    });

    // Create credits for workspace
    await prisma.workspaceCredits.create({
      data: {
        workspaceId,
        balance: 10000,
      },
    });

    // Generate tokens
    const adminAuthTokens = await issueTokens({
      userId: adminUserId,
      email: adminUserCreated.email,
      role: adminUserCreated.role,
    });
    adminToken = adminAuthTokens.accessToken;

    const regularAuthTokens = await issueTokens({
      userId: regularUserId,
      email: regularUserCreated.email,
      role: regularUserCreated.role,
    });
    regularToken = regularAuthTokens.accessToken;
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
      await prisma.auditLog.deleteMany({
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
        where: { id: { in: [adminUserId, regularUserId] } },
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

  describe('GET /api/admin/plans', () => {
    it('lists all plans', async () => {
      const res = await request(app)
        .get('/api/admin/plans')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .get('/api/admin/plans')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/plans', () => {
    it('creates new plan', async () => {
      const res = await request(app)
        .post('/api/admin/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          key: `admin-plan-${Date.now()}`,
          name: 'Admin Plan',
          interval: 'MONTH',
          priceCents: 9999,
          creditsPerInterval: 5000,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('key');
      testPlanIds.push(res.body.id);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .post('/api/admin/plans')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({
          key: `plan-${Date.now()}`,
          name: 'Test Plan',
          interval: 'MONTH',
          priceCents: 9999,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/admin/plans/:planId', () => {
    it('updates plan', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `update-plan-${Date.now()}`,
          name: 'Original Name',
          interval: 'MONTH',
          priceCents: 9999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const res = await request(app)
        .patch(`/api/admin/plans/${plan.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Updated Name',
          priceCents: 19999,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'Updated Name');
      expect(res.body).toHaveProperty('priceCents', 19999);
    });

    it('requires admin role', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `patch-plan-${Date.now()}`,
          name: 'Test',
          interval: 'MONTH',
          priceCents: 9999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const res = await request(app)
        .patch(`/api/admin/plans/${plan.id}`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/plans/:planId/archive', () => {
    it('archives plan', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `archive-plan-${Date.now()}`,
          name: 'Archive Test',
          interval: 'MONTH',
          priceCents: 9999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const res = await request(app)
        .post(`/api/admin/plans/${plan.id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ARCHIVED');
    });

    it('requires admin role', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `admin-archive-${Date.now()}`,
          name: 'Test',
          interval: 'MONTH',
          priceCents: 9999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const res = await request(app)
        .post(`/api/admin/plans/${plan.id}/archive`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/plans/:planId/set-default', () => {
    it('sets plan as default', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `set-default-${Date.now()}`,
          name: 'Default Plan',
          interval: 'MONTH',
          priceCents: 9999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const res = await request(app)
        .post(`/api/admin/plans/${plan.id}/set-default`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('isDefault', true);
    });

    it('requires admin role', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `admin-default-${Date.now()}`,
          name: 'Test',
          interval: 'MONTH',
          priceCents: 9999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const res = await request(app)
        .post(`/api/admin/plans/${plan.id}/set-default`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/billing/past-due', () => {
    it('lists past-due workspaces ordered longest-struggling first', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `past-due-plan-${Date.now()}`,
          name: 'Past Due Plan',
          interval: 'MONTH',
          priceCents: 4999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const olderWorkspace = await prisma.workspace.create({
        data: { name: 'Struggling Longer', slug: `struggling-longer-${Date.now()}` },
      });
      testWorkspaceIds.push(olderWorkspace.id);
      await prisma.subscription.create({
        data: {
          workspaceId: olderWorkspace.id,
          planId: plan.id,
          status: 'PAST_DUE',
          pastDueSince: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          paymentFailureCount: 3,
        },
      });

      await prisma.subscription.create({
        data: {
          workspaceId,
          planId: plan.id,
          status: 'PAST_DUE',
          pastDueSince: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          paymentFailureCount: 1,
        },
      });

      const res = await request(app)
        .get('/api/admin/billing/past-due')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].workspaceId).toBe(olderWorkspace.id);
      expect(res.body[0].paymentFailureCount).toBe(3);
      expect(res.body[1].workspaceId).toBe(workspaceId);

      await prisma.subscription.deleteMany({ where: { workspaceId: olderWorkspace.id } });
      await prisma.subscription.deleteMany({ where: { workspaceId } });
    });

    it('excludes ACTIVE and CANCELED subscriptions', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `not-past-due-plan-${Date.now()}`,
          name: 'Not Past Due Plan',
          interval: 'MONTH',
          priceCents: 1999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);
      await prisma.subscription.create({
        data: { workspaceId, planId: plan.id, status: 'ACTIVE' },
      });

      const res = await request(app)
        .get('/api/admin/billing/past-due')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);

      await prisma.subscription.deleteMany({ where: { workspaceId } });
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .get('/api/admin/billing/past-due')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/workspaces/:workspaceId/billing', () => {
    it('returns composed subscription, credit balance, invoices, and ledger', async () => {
      const plan = await prisma.plan.create({
        data: {
          key: `billing-view-plan-${Date.now()}`,
          name: 'Billing View Plan',
          interval: 'MONTH',
          priceCents: 2999,
          status: 'ACTIVE',
        },
      });
      testPlanIds.push(plan.id);

      const subscription = await prisma.subscription.create({
        data: { workspaceId, planId: plan.id, status: 'ACTIVE' },
      });

      await prisma.invoice.create({
        data: {
          subscriptionId: subscription.id,
          workspaceId,
          provider: 'stripe',
          externalInvoiceId: `inv_${Date.now()}`,
          status: 'PAID',
          amountDueCents: 2999,
          amountPaidCents: 2999,
        },
      });

      const res = await request(app)
        .get(`/api/admin/workspaces/${workspaceId}/billing`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.workspaceId).toBe(workspaceId);
      expect(res.body.subscription).toHaveProperty('planId', plan.id);
      expect(res.body.subscription.plan).toHaveProperty('id', plan.id);
      expect(res.body.creditBalance).toBe(10000);
      expect(res.body.recentInvoices).toHaveLength(1);
      expect(res.body.recentInvoices[0]).toHaveProperty('status', 'PAID');
      expect(Array.isArray(res.body.recentLedgerEntries)).toBe(true);

      await prisma.invoice.deleteMany({ where: { workspaceId } });
      await prisma.subscription.deleteMany({ where: { workspaceId } });
    });

    it('returns null subscription/credits for a workspace with no billing data yet', async () => {
      const bareWorkspace = await prisma.workspace.create({
        data: { name: 'Bare Workspace', slug: `bare-${Date.now()}` },
      });
      testWorkspaceIds.push(bareWorkspace.id);

      const res = await request(app)
        .get(`/api/admin/workspaces/${bareWorkspace.id}/billing`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.subscription).toBeNull();
      expect(res.body.creditBalance).toBeNull();
      expect(res.body.recentInvoices).toHaveLength(0);
    });

    it('returns 404 for a non-existent workspace', async () => {
      const res = await request(app)
        .get('/api/admin/workspaces/nonexistent/billing')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .get(`/api/admin/workspaces/${workspaceId}/billing`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/workspaces/:workspaceId/credits/grant', () => {
    it('grants credits to workspace', async () => {
      const creditsBefore = await prisma.workspaceCredits.findUnique({
        where: { workspaceId },
      });

      const res = await request(app)
        .post(`/api/admin/workspaces/${workspaceId}/credits/grant`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 5000,
          reason: 'Manual grant',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('balance', (creditsBefore?.balance || 0) + 5000);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .post(`/api/admin/workspaces/${workspaceId}/credits/grant`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({
          amount: 5000,
          reason: 'Manual grant',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/workspaces/:workspaceId/credits/adjust', () => {
    it('adjusts workspace credits', async () => {
      const res = await request(app)
        .post(`/api/admin/workspaces/${workspaceId}/credits/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: -1000,
          reason: 'Adjustment',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('balance');
      expect(res.body.balance).toBe(9000);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .post(`/api/admin/workspaces/${workspaceId}/credits/adjust`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({
          amount: -1000,
          reason: 'Adjustment',
        });

      expect(res.status).toBe(403);
    });
  });
});
