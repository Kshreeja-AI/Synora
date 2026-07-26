import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import {
  getCreditBalance,
  grantCredits,
  adjustCredits,
  recordUsage,
  getUsageSummary,
  listCreditLedger,
  InsufficientCreditsError,
} from '../credit.service';
import { NotFoundException } from '@synora/shared';

describe('credit.service', () => {
  const testWorkspaceIds: string[] = [];
  let workspaceId: string;

  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(async () => {
    // Create a test workspace with credits
    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `test-${Date.now()}` },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    await prisma.workspaceCredits.create({
      data: { workspaceId, balance: 10000 },
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
      await prisma.workspaceCredits.deleteMany({
        where: { workspaceId: { in: testWorkspaceIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: testWorkspaceIds } },
      });
      testWorkspaceIds.length = 0;
    }
  });

  describe('getCreditBalance', () => {
    it('returns the current credit balance', async () => {
      const balance = await getCreditBalance('user-id', workspaceId);
      expect(balance).toBe(10000);
    });

    it('throws NotFoundException for non-existent workspace', async () => {
      await expect(getCreditBalance('user-id', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('grantCredits', () => {
    it('grants credits and creates ledger entry', async () => {
      await grantCredits('admin-user', workspaceId, {
        amount: 5000,
        reason: 'Manual grant',
      });

      const balance = await getCreditBalance('user-id', workspaceId);
      expect(balance).toBe(15000);

      const ledger = await listCreditLedger('user-id', workspaceId);
      const entry = ledger.find((e) => e.type === 'GRANT');
      expect(entry).toBeDefined();
      expect(entry?.amount).toBe(5000);
    });

    it('records audit event', async () => {
      await grantCredits('admin-user', workspaceId, {
        amount: 1000,
        reason: 'Test grant',
      });

      const auditLogs = await prisma.auditLog.findMany({
        where: { workspaceId, action: 'credits_granted' },
      });

      expect(auditLogs.length).toBeGreaterThan(0);
    });
  });

  describe('adjustCredits', () => {
    it('adjusts credits positively', async () => {
      await adjustCredits('admin-user', workspaceId, {
        amount: 3000,
        reason: 'Adjustment up',
      });

      const balance = await getCreditBalance('user-id', workspaceId);
      expect(balance).toBe(13000);
    });

    it('adjusts credits negatively but not below zero', async () => {
      await adjustCredits('admin-user', workspaceId, {
        amount: -15000,
        reason: 'Large adjustment down',
      });

      const balance = await getCreditBalance('user-id', workspaceId);
      expect(balance).toBe(0);
    });

    it('creates adjustment ledger entry', async () => {
      await adjustCredits('admin-user', workspaceId, {
        amount: -2000,
        reason: 'Test adjustment',
      });

      const ledger = await listCreditLedger('user-id', workspaceId);
      const entry = ledger.find((e) => e.type === 'ADJUSTMENT');
      expect(entry).toBeDefined();
      expect(entry?.amount).toBe(-2000);
    });
  });

  describe('recordUsage', () => {
    it('records usage and deducts credits', async () => {
      await recordUsage(workspaceId, {
        capability: 'text_generation',
        quantity: 100,
        creditsCost: 250,
        userId: 'user-123',
      });

      const balance = await getCreditBalance('user-id', workspaceId);
      expect(balance).toBe(9750);
    });

    it('throws InsufficientCreditsError when balance is too low', async () => {
      await expect(
        recordUsage(workspaceId, {
          capability: 'text_generation',
          quantity: 1,
          creditsCost: 15000,
        })
      ).rejects.toThrow(InsufficientCreditsError);
    });

    it('creates usage record', async () => {
      await recordUsage(workspaceId, {
        capability: 'image_generation',
        quantity: 5,
        creditsCost: 500,
        userId: 'user-123',
        metadata: { model: 'dall-e-3' },
      });

      const usage = await prisma.usageRecord.findFirst({
        where: { workspaceId },
      });

      expect(usage?.capability).toBe('image_generation');
      expect(usage?.quantity).toBe(5);
      expect(usage?.creditsCost).toBe(500);
    });

    it('creates deduction ledger entry', async () => {
      await recordUsage(workspaceId, {
        capability: 'text_generation',
        quantity: 1,
        creditsCost: 100,
      });

      const ledger = await listCreditLedger('user-id', workspaceId);
      const entry = ledger.find((e) => e.type === 'DEDUCTION');
      expect(entry).toBeDefined();
      expect(entry?.amount).toBe(-100);
    });
  });

  describe('getUsageSummary', () => {
    it('returns empty summary when no usage', async () => {
      const summary = await getUsageSummary('user-id', workspaceId);
      expect(Object.keys(summary)).toHaveLength(0);
    });

    it('aggregates usage by capability', async () => {
      await recordUsage(workspaceId, {
        capability: 'text_generation',
        quantity: 10,
        creditsCost: 100,
      });
      await recordUsage(workspaceId, {
        capability: 'text_generation',
        quantity: 15,
        creditsCost: 150,
      });
      await recordUsage(workspaceId, {
        capability: 'image_generation',
        quantity: 5,
        creditsCost: 250,
      });

      const summary = await getUsageSummary('user-id', workspaceId);

      expect(summary.text_generation).toEqual({
        quantity: 25,
        creditsCost: 250,
      });
      expect(summary.image_generation).toEqual({
        quantity: 5,
        creditsCost: 250,
      });
    });
  });

  describe('listCreditLedger', () => {
    it('returns ledger entries sorted by date descending', async () => {
      await grantCredits('admin-user', workspaceId, {
        amount: 1000,
        reason: 'Grant 1',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await adjustCredits('admin-user', workspaceId, {
        amount: -500,
        reason: 'Adjust 1',
      });

      const ledger = await listCreditLedger('user-id', workspaceId);
      expect(ledger.length).toBeGreaterThanOrEqual(2);
      expect(ledger[0].createdAt >= ledger[1].createdAt).toBe(true);
    });

    it('returns up to 50 entries', async () => {
      for (let i = 0; i < 60; i++) {
        await adjustCredits('admin-user', workspaceId, {
          amount: -1,
          reason: `Adjust ${i}`,
        });
      }

      const ledger = await listCreditLedger('user-id', workspaceId);
      expect(ledger.length).toBeLessThanOrEqual(50);
    });
  });
});
