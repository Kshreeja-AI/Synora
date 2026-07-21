import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RateLimiterService, createRateLimiterService } from '../rate-limiter.service';

describe('RateLimiterService', () => {
  let prisma: PrismaClient;
  let rateLimiter: RateLimiterService;

  beforeAll(() => {
    prisma = new PrismaClient();
    rateLimiter = createRateLimiterService(prisma, {
      maxAttemptsPerWindow: 5,
      windowMinutes: 15,
      lockoutMinutes: 30,
      progressiveLockout: true,
    });
  });

  afterAll(async () => {
    await prisma.mFAAuditLog.deleteMany({});
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.mFAAuditLog.deleteMany({});
  });

  describe('checkVerificationAttempt()', () => {
    it('should allow attempts below limit', async () => {
      const userId = 'user-limit-1';

      for (let i = 0; i < 3; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const status = await rateLimiter.checkVerificationAttempt(userId);

      expect(status.isRateLimited).toBe(false);
      expect(status.remainingAttempts).toBe(2);
    });

    it('should block at rate limit threshold', async () => {
      const userId = 'user-limit-2';

      for (let i = 0; i < 5; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const status = await rateLimiter.checkVerificationAttempt(userId);

      expect(status.isRateLimited).toBe(true);
      expect(status.remainingAttempts).toBe(0);
    });

    it('should block account lockout', async () => {
      const userId = 'user-limit-3';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });

      const status = await rateLimiter.checkVerificationAttempt(userId);

      expect(status.isRateLimited).toBe(true);
      expect(status.lockoutUntil).toBeDefined();
    });

    it('should respect rate limit window', async () => {
      const userId = 'user-limit-4';
      const oldTime = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago, outside 15-min window

      for (let i = 0; i < 5; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: oldTime },
        });
      }

      // These old attempts are outside the window, so new attempts should be allowed
      const status = await rateLimiter.checkVerificationAttempt(userId);

      expect(status.isRateLimited).toBe(false);
      expect(status.remainingAttempts).toBe(5); // Full limit available
    });

    it('should count only failures, not successes', async () => {
      const userId = 'user-limit-5';

      for (let i = 0; i < 3; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
        });
      }

      for (let i = 0; i < 2; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const status = await rateLimiter.checkVerificationAttempt(userId);

      expect(status.isRateLimited).toBe(false);
      expect(status.remainingAttempts).toBe(3);
    });
  });

  describe('checkRecoveryCodeAttempt()', () => {
    it('should be stricter than regular verification', async () => {
      const userId = 'user-recovery-1';

      // Recovery codes allow half the attempts (2.5, rounded to 2)
      for (let i = 0; i < 2; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const status = await rateLimiter.checkRecoveryCodeAttempt(userId);

      expect(status.isRateLimited).toBe(true);
    });

    it('should not block until threshold', async () => {
      const userId = 'user-recovery-2';

      for (let i = 0; i < 1; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const status = await rateLimiter.checkRecoveryCodeAttempt(userId);

      expect(status.isRateLimited).toBe(false);
    });
  });

  describe('getProgressiveLockoutDuration()', () => {
    it('should start with base lockout duration', async () => {
      const userId = 'user-progressive-1';

      const duration = await rateLimiter.getProgressiveLockoutDuration(userId);

      expect(duration).toBe(30); // Default lockoutMinutes
    });

    it('should double on second lockout', async () => {
      const userId = 'user-progressive-2';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });

      const duration = await rateLimiter.getProgressiveLockoutDuration(userId);

      expect(duration).toBe(60); // 30 * 2^1
    });

    it('should exponentially increase lockout duration', async () => {
      const userId = 'user-progressive-3';

      // Create 3 lockouts
      for (let i = 0; i < 3; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
        });
      }

      const duration = await rateLimiter.getProgressiveLockoutDuration(userId);

      expect(duration).toBe(240); // 30 * 2^3
    });

    it('should cap progressive lockout at 5x multiplier', async () => {
      const userId = 'user-progressive-4';

      // Create 10 lockouts (more than cap)
      for (let i = 0; i < 10; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
        });
      }

      const duration = await rateLimiter.getProgressiveLockoutDuration(userId);

      expect(duration).toBeLessThanOrEqual(960); // 30 * 2^5
    });

    it('should only count lockouts in last 7 days', async () => {
      const userId = 'user-progressive-5';
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

      // Create old lockout
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: eightDaysAgo },
      });

      // Duration should not include the old lockout
      const duration = await rateLimiter.getProgressiveLockoutDuration(userId);

      expect(duration).toBe(30); // Base duration, old lockout not counted
    });
  });

  describe('isIpRateLimited()', () => {
    it('should track IP-based rate limiting', async () => {
      const ipAddress = '192.168.1.100';
      const userId = 'user-ip-1';

      // Simulate logs from same IP by creating metadata
      for (let i = 0; i < 15; i++) {
        await prisma.mFAAuditLog.create({
          data: {
            userId,
            action: 'VERIFICATION_FAILED',
            timestamp: new Date(),
            metadata: JSON.stringify({ ipAddress }),
          },
        });
      }

      const status = await rateLimiter.isIpRateLimited(ipAddress);

      expect(status.isRateLimited).toBe(false); // 15 is below 20 limit
      expect(status.remainingAttempts).toBe(5);
    });

    it('should block IP at limit', async () => {
      const ipAddress = '192.168.1.101';
      const userId = 'user-ip-2';

      for (let i = 0; i < 20; i++) {
        await prisma.mFAAuditLog.create({
          data: {
            userId,
            action: 'VERIFICATION_FAILED',
            timestamp: new Date(),
            metadata: JSON.stringify({ ipAddress }),
          },
        });
      }

      const status = await rateLimiter.isIpRateLimited(ipAddress);

      expect(status.isRateLimited).toBe(true);
      expect(status.remainingAttempts).toBe(0);
    });
  });

  describe('clearLockout()', () => {
    it('should create ACCOUNT_UNLOCKED event', async () => {
      const userId = 'user-unlock-1';

      await rateLimiter.clearLockout(userId);

      const logs = await prisma.mFAAuditLog.findMany({ where: { userId } });

      expect(logs.some((l) => l.action === 'ACCOUNT_UNLOCKED')).toBe(true);
    });
  });

  describe('getAttemptHistory()', () => {
    it('should return attempt history', async () => {
      const userId = 'user-history-1';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
      });

      const history = await rateLimiter.getAttemptHistory(userId);

      expect(history.length).toBe(2);
      expect(history[0].action).toBe('VERIFICATION_FAILED');
      expect(history[1].action).toBe('VERIFICATION_SUCCESS');
    });

    it('should respect limit parameter', async () => {
      const userId = 'user-history-2';

      for (let i = 0; i < 15; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
        });
      }

      const history = await rateLimiter.getAttemptHistory(userId, 5);

      expect(history.length).toBe(5);
    });
  });

  describe('Factory function', () => {
    it('should create service instance with default config', () => {
      const service = createRateLimiterService(prisma);

      expect(service).toBeInstanceOf(RateLimiterService);
    });

    it('should create service with custom config', () => {
      const service = createRateLimiterService(prisma, {
        maxAttemptsPerWindow: 3,
        windowMinutes: 10,
      });

      expect(service).toBeInstanceOf(RateLimiterService);
    });
  });
});
