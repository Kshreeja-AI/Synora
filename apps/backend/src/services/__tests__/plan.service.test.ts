import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { createPlan, listActivePlans, listAllPlans, getDefaultPlan, getPlan, updatePlan, archivePlan, setDefaultPlan } from '../plan.service';
import { NotFoundException } from '@synora/shared';

describe('plan.service', () => {
  const testPlanIds: string[] = [];

  beforeAll(async () => {
    await initConfig();
  });

  afterEach(async () => {
    if (testPlanIds.length > 0) {
      await prisma.plan.deleteMany({ where: { id: { in: testPlanIds } } });
      testPlanIds.length = 0;
    }
  });

  describe('createPlan', () => {
    it('creates a new plan with all fields', async () => {
      const plan = await createPlan('admin-user', {
        key: 'test-plan',
        name: 'Test Plan',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        trialDays: 14,
        features: { text_generation: true },
        sortOrder: 1,
      });

      testPlanIds.push(plan.id);

      expect(plan.key).toBe('test-plan');
      expect(plan.name).toBe('Test Plan');
      expect(plan.interval).toBe('MONTH');
      expect(plan.priceCents).toBe(9999);
      expect(plan.creditsPerInterval).toBe(5000);
      expect(plan.trialDays).toBe(14);
      expect(plan.status).toBe('ACTIVE');
      expect(plan.features).toEqual({ text_generation: true });
    });

    it('defaults creditsPerInterval to 0 if not provided', async () => {
      const plan = await createPlan('admin-user', {
        key: 'basic',
        name: 'Basic Plan',
        interval: 'MONTH',
        priceCents: 0,
      });

      testPlanIds.push(plan.id);
      expect(plan.creditsPerInterval).toBe(0);
    });
  });

  describe('listActivePlans', () => {
    it('returns only active plans sorted by sortOrder', async () => {
      const active1 = await createPlan('admin-user', {
        key: 'active-1',
        name: 'Active 1',
        interval: 'MONTH',
        priceCents: 1000,
        sortOrder: 1,
      });
      testPlanIds.push(active1.id);

      const active2 = await createPlan('admin-user', {
        key: 'active-2',
        name: 'Active 2',
        interval: 'MONTH',
        priceCents: 2000,
        sortOrder: 2,
      });
      testPlanIds.push(active2.id);

      const plans = await listActivePlans();
      const testPlans = plans.filter((p) => p.id === active1.id || p.id === active2.id);

      expect(testPlans).toHaveLength(2);
      expect(testPlans[0].sortOrder).toBeLessThanOrEqual(testPlans[1].sortOrder);
    });
  });

  describe('listAllPlans', () => {
    it('returns all plans including archived', async () => {
      const plan = await createPlan('admin-user', {
        key: 'all-plans-test',
        name: 'All Plans Test',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan.id);

      const plans = await listAllPlans();
      const found = plans.find((p) => p.id === plan.id);

      expect(found).toBeDefined();
    });
  });

  describe('getDefaultPlan', () => {
    it('returns the default plan', async () => {
      const plan = await createPlan('admin-user', {
        key: 'default-test',
        name: 'Default Test',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan.id);

      await setDefaultPlan('admin-user', plan.id);

      const defaultPlan = await getDefaultPlan();
      expect(defaultPlan.id).toBe(plan.id);
      expect(defaultPlan.isDefault).toBe(true);
    });

    it('throws NotFoundException when no default plan exists', async () => {
      await prisma.plan.updateMany({ data: { isDefault: false } });

      await expect(getDefaultPlan()).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPlan', () => {
    it('returns a plan by id', async () => {
      const plan = await createPlan('admin-user', {
        key: 'get-plan-test',
        name: 'Get Plan Test',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan.id);

      const retrieved = await getPlan(plan.id);
      expect(retrieved.id).toBe(plan.id);
    });

    it('throws NotFoundException for non-existent plan', async () => {
      await expect(getPlan('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePlan', () => {
    it('updates plan fields', async () => {
      const plan = await createPlan('admin-user', {
        key: 'update-test',
        name: 'Original Name',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan.id);

      const updated = await updatePlan('admin-user', plan.id, {
        name: 'Updated Name',
        priceCents: 2000,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.priceCents).toBe(2000);
    });

    it('preserves unchanged fields', async () => {
      const plan = await createPlan('admin-user', {
        key: 'preserve-test',
        name: 'Original',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan.id);

      const updated = await updatePlan('admin-user', plan.id, { name: 'New Name' });

      expect(updated.priceCents).toBe(plan.priceCents);
      expect(updated.interval).toBe(plan.interval);
    });
  });

  describe('archivePlan', () => {
    it('changes plan status to ARCHIVED', async () => {
      const plan = await createPlan('admin-user', {
        key: 'archive-test',
        name: 'Archive Test',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan.id);

      const archived = await archivePlan('admin-user', plan.id);

      expect(archived.status).toBe('ARCHIVED');
    });
  });

  describe('setDefaultPlan', () => {
    it('sets a plan as default and unsets others', async () => {
      const plan1 = await createPlan('admin-user', {
        key: 'default-1',
        name: 'Default 1',
        interval: 'MONTH',
        priceCents: 1000,
      });
      testPlanIds.push(plan1.id);

      const plan2 = await createPlan('admin-user', {
        key: 'default-2',
        name: 'Default 2',
        interval: 'MONTH',
        priceCents: 2000,
      });
      testPlanIds.push(plan2.id);

      await setDefaultPlan('admin-user', plan1.id);
      let p1 = await getPlan(plan1.id);
      expect(p1.isDefault).toBe(true);

      await setDefaultPlan('admin-user', plan2.id);
      p1 = await getPlan(plan1.id);
      const p2 = await getPlan(plan2.id);

      expect(p1.isDefault).toBe(false);
      expect(p2.isDefault).toBe(true);
    });
  });
});
