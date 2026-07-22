import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { checkLockout, recordFailedLogin, clearLoginLockout } from '../lockout.service';

describe('lockout.service', () => {
  const testEmails: string[] = [];

  beforeAll(async () => {
    // recordFailedLogin() reads getConfig().auth.maxFailedLoginAttempts,
    // which throws unless initConfig() has run in this test file's own
    // module context.
    await initConfig();
  });

  afterEach(async () => {
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
  });

  async function makeUser() {
    const email = `lockout-unit-${Date.now()}-${Math.random()}@example.com`;
    testEmails.push(email);
    return prisma.user.create({ data: { email, password: 'irrelevant-for-this-test' } });
  }

  describe('checkLockout()', () => {
    it('is not locked when lockedUntil is null', () => {
      expect(checkLockout({ lockedUntil: null }).isLocked).toBe(false);
    });

    it('is locked when lockedUntil is in the future', () => {
      const future = new Date(Date.now() + 60_000);
      const status = checkLockout({ lockedUntil: future });
      expect(status.isLocked).toBe(true);
      expect(status.lockedUntil).toEqual(future);
    });

    it('is not locked when lockedUntil is in the past', () => {
      const past = new Date(Date.now() - 60_000);
      expect(checkLockout({ lockedUntil: past }).isLocked).toBe(false);
    });
  });

  describe('recordFailedLogin()', () => {
    it('increments the counter below threshold without locking', async () => {
      const user = await makeUser();

      await recordFailedLogin(user.id);
      const after1 = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after1?.failedLoginAttempts).toBe(1);
      expect(after1?.lockedUntil).toBeNull();
    });

    it('locks the account once the configured threshold (default 5) is reached', async () => {
      const user = await makeUser();

      for (let i = 0; i < 5; i++) {
        await recordFailedLogin(user.id);
      }

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after?.lockedUntil).not.toBeNull();
      expect(after!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      // Counter resets on lock so a future unlock starts a fresh count.
      expect(after?.failedLoginAttempts).toBe(0);
    });

    it('is a no-op for a non-existent user id (never throws)', async () => {
      await expect(recordFailedLogin('non-existent-user-id')).resolves.toBeUndefined();
    });
  });

  describe('clearLoginLockout()', () => {
    it('resets both the counter and lockedUntil', async () => {
      const user = await makeUser();
      for (let i = 0; i < 5; i++) await recordFailedLogin(user.id);

      const locked = await prisma.user.findUnique({ where: { id: user.id } });
      expect(locked?.lockedUntil).not.toBeNull();

      await clearLoginLockout(user.id);

      const cleared = await prisma.user.findUnique({ where: { id: user.id } });
      expect(cleared?.failedLoginAttempts).toBe(0);
      expect(cleared?.lockedUntil).toBeNull();
    });
  });
});
