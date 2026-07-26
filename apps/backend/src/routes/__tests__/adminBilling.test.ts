import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import app from '../../index';
import { generateToken } from '../../services/token.service';

describe('admin billing routes', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let adminUserId: string;
  let regularUserId: string;
  let workspaceId: string;
  let adminToken: string;
  let regularToken: string;

  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(async () => {
    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@test.com`,
        hashedPassword: 'hashed',
        isAdmin: true,
      },
    });
    adminUserId = adminUser.id;

    // Create regular user
    const regularUser = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.com`,
        hashedPassword: 'hashed',
      },
    });
    regularUserId = regularUser.id;

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
    adminToken = await generateToken(adminUserId, { workspaceId });
    regularToken = await generateToken(regularUserId, { workspaceId });
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
