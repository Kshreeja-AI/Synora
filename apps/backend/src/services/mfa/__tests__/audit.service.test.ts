import { PrismaClient } from '@prisma/client';
import { MFAAuditService, MFAAuditAction, createMFAAuditService } from '../audit.service';

describe('MFAAuditService', () => {
  let prisma: PrismaClient;
  let auditService: MFAAuditService;
  const testUserId = 'test-user-123';

  beforeAll(() => {
    prisma = new PrismaClient();
    auditService = createMFAAuditService(prisma);
  });

  afterAll(async () => {
    await prisma.mFAAuditLog.deleteMany({});
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.mFAAuditLog.deleteMany({});
  });

  describe('log()', () => {
    it('should create audit log entry with action', async () => {
      await auditService.log(testUserId, MFAAuditAction.SETUP_INITIATED);

      const logs = await prisma.mFAAuditLog.findMany({
        where: { userId: testUserId },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        userId: testUserId,
        action: MFAAuditAction.SETUP_INITIATED,
        metadata: null,
      });
    });

    it('should log with metadata', async () => {
      const metadata = { deviceName: 'iPhone', ipAddress: '192.168.1.1' };
      await auditService.log(testUserId, MFAAuditAction.VERIFICATION_SUCCESS, metadata);

      const logs = await prisma.mFAAuditLog.findMany({
        where: { userId: testUserId },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toEqual(metadata);
    });

    it('should preserve metadata types (string, number, boolean, null)', async () => {
      const metadata = {
        deviceName: 'Pixel Phone',
        attemptCount: 3,
        isRecovery: true,
        errorMessage: null,
      };
      await auditService.log(testUserId, MFAAuditAction.SETUP_COMPLETED, metadata);

      const logs = await prisma.mFAAuditLog.findMany({
        where: { userId: testUserId },
      });

      expect(logs[0].metadata).toEqual(metadata);
    });

    it('should set timestamp on creation', async () => {
      const beforeTime = new Date();
      await auditService.log(testUserId, MFAAuditAction.SETUP_INITIATED);
      const afterTime = new Date();

      const logs = await prisma.mFAAuditLog.findMany({
        where: { userId: testUserId },
      });

      expect(logs[0].timestamp).toBeInstanceOf(Date);
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should handle custom action strings', async () => {
      const customAction = 'CUSTOM_MFA_EVENT';
      await auditService.log(testUserId, customAction);

      const logs = await prisma.mFAAuditLog.findMany({
        where: { userId: testUserId },
      });

      expect(logs[0].action).toBe(customAction);
    });

    it('should throw error on database failure', async () => {
      jest.spyOn(prisma.mFAAuditLog, 'create').mockRejectedValueOnce(new Error('DB Error'));

      await expect(auditService.log(testUserId, MFAAuditAction.SETUP_INITIATED)).rejects.toThrow('DB Error');
    });
  });

  describe('getUserLogs()', () => {
    it('should return user logs in reverse chronological order', async () => {
      const userId = 'user-logs-test';
      for (let i = 0; i < 3; i++) {
        await auditService.log(userId, MFAAuditAction.SETUP_INITIATED);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const logs = await auditService.getUserLogs(userId);

      expect(logs).toHaveLength(3);
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp.getTime()).toBeGreaterThanOrEqual(logs[i + 1].timestamp.getTime());
      }
    });

    it('should respect limit parameter', async () => {
      const userId = 'user-limit-test';
      for (let i = 0; i < 5; i++) {
        await auditService.log(userId, MFAAuditAction.SETUP_INITIATED);
      }

      const logs = await auditService.getUserLogs(userId, 3);

      expect(logs).toHaveLength(3);
    });

    it('should return empty array for user with no logs', async () => {
      const logs = await auditService.getUserLogs('non-existent-user');

      expect(logs).toEqual([]);
    });

    it('should return only logs for specified user', async () => {
      const user1 = 'user-1';
      const user2 = 'user-2';

      await auditService.log(user1, MFAAuditAction.SETUP_INITIATED);
      await auditService.log(user2, MFAAuditAction.VERIFICATION_SUCCESS);

      const user1Logs = await auditService.getUserLogs(user1);
      const user2Logs = await auditService.getUserLogs(user2);

      expect(user1Logs).toHaveLength(1);
      expect(user1Logs[0].userId).toBe(user1);
      expect(user2Logs).toHaveLength(1);
      expect(user2Logs[0].userId).toBe(user2);
    });
  });

  describe('getLogsByAction()', () => {
    it('should return logs filtered by action', async () => {
      await auditService.log('user1', MFAAuditAction.SETUP_INITIATED);
      await auditService.log('user2', MFAAuditAction.SETUP_INITIATED);
      await auditService.log('user3', MFAAuditAction.VERIFICATION_SUCCESS);

      const setupLogs = await auditService.getLogsByAction(MFAAuditAction.SETUP_INITIATED);

      expect(setupLogs).toHaveLength(2);
      expect(setupLogs.every((log) => log.action === MFAAuditAction.SETUP_INITIATED)).toBe(true);
    });

    it('should return logs in reverse chronological order', async () => {
      for (let i = 0; i < 3; i++) {
        await auditService.log('user1', MFAAuditAction.VERIFICATION_SUCCESS);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const logs = await auditService.getLogsByAction(MFAAuditAction.VERIFICATION_SUCCESS);

      expect(logs).toHaveLength(3);
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp.getTime()).toBeGreaterThanOrEqual(logs[i + 1].timestamp.getTime());
      }
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await auditService.log('user1', MFAAuditAction.VERIFICATION_FAILED);
      }

      const logs = await auditService.getLogsByAction(MFAAuditAction.VERIFICATION_FAILED, 2);

      expect(logs).toHaveLength(2);
    });
  });

  describe('getLogsByTimeRange()', () => {
    it('should return logs within time range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      await auditService.log('user1', MFAAuditAction.SETUP_INITIATED);
      const logsInRange = await auditService.getLogsByTimeRange(twoHoursAgo, now);

      expect(logsInRange.length).toBeGreaterThan(0);
      expect(logsInRange.every((log) => log.timestamp >= twoHoursAgo && log.timestamp <= now)).toBe(true);
    });

    it('should exclude logs outside time range', async () => {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 60 * 60 * 1000);
      const futureEndTime = new Date(futureTime.getTime() + 60 * 60 * 1000);

      await auditService.log('user1', MFAAuditAction.SETUP_INITIATED);
      const logs = await auditService.getLogsByTimeRange(futureTime, futureEndTime);

      expect(logs).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const now = new Date();
      const pastTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      for (let i = 0; i < 5; i++) {
        await auditService.log('user1', MFAAuditAction.VERIFICATION_SUCCESS);
      }

      const logs = await auditService.getLogsByTimeRange(pastTime, now, 2);

      expect(logs.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getUserSecurityEvents()', () => {
    it('should return only security-related events', async () => {
      const userId = 'security-test-user';

      await auditService.log(userId, MFAAuditAction.VERIFICATION_SUCCESS);
      await auditService.log(userId, MFAAuditAction.VERIFICATION_FAILED);
      await auditService.log(userId, MFAAuditAction.ACCOUNT_LOCKOUT);
      await auditService.log(userId, MFAAuditAction.SETUP_COMPLETED);

      const securityEvents = await auditService.getUserSecurityEvents(userId);

      expect(securityEvents).toHaveLength(2);
      expect(securityEvents.every((log) =>
        [MFAAuditAction.VERIFICATION_FAILED, MFAAuditAction.ACCOUNT_LOCKOUT].includes(log.action as MFAAuditAction)
      )).toBe(true);
    });

    it('should respect lookback window', async () => {
      const userId = 'lookback-test-user';
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      await auditService.log(userId, MFAAuditAction.VERIFICATION_FAILED);

      const events1h = await auditService.getUserSecurityEvents(userId, 1);
      const events3h = await auditService.getUserSecurityEvents(userId, 3);

      expect(events1h).toHaveLength(0);
      expect(events3h).toHaveLength(1);
    });

    it('should include recovery code usage as security event', async () => {
      const userId = 'recovery-test-user';

      await auditService.log(userId, MFAAuditAction.RECOVERY_CODE_USED);

      const events = await auditService.getUserSecurityEvents(userId);

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(MFAAuditAction.RECOVERY_CODE_USED);
    });
  });

  describe('countFailedVerificationAttempts()', () => {
    it('should count failed verification attempts', async () => {
      const userId = 'failure-count-test';

      for (let i = 0; i < 3; i++) {
        await auditService.log(userId, MFAAuditAction.VERIFICATION_FAILED);
      }

      const count = await auditService.countFailedVerificationAttempts(userId);

      expect(count).toBe(3);
    });

    it('should only count failures within lookback window', async () => {
      const userId = 'failure-window-test';

      for (let i = 0; i < 2; i++) {
        await auditService.log(userId, MFAAuditAction.VERIFICATION_FAILED);
      }

      const count1m = await auditService.countFailedVerificationAttempts(userId, 1);
      const count60m = await auditService.countFailedVerificationAttempts(userId, 60);

      expect(count1m).toBe(2);
      expect(count60m).toBe(2);
    });

    it('should not count successful verifications', async () => {
      const userId = 'failure-vs-success-test';

      await auditService.log(userId, MFAAuditAction.VERIFICATION_FAILED);
      await auditService.log(userId, MFAAuditAction.VERIFICATION_SUCCESS);
      await auditService.log(userId, MFAAuditAction.VERIFICATION_FAILED);

      const count = await auditService.countFailedVerificationAttempts(userId);

      expect(count).toBe(2);
    });

    it('should return 0 for user with no failures', async () => {
      const count = await auditService.countFailedVerificationAttempts('non-existent-user');

      expect(count).toBe(0);
    });
  });

  describe('cleanupOldLogs()', () => {
    it('should delete logs older than retention period', async () => {
      const userId = 'cleanup-test';
      const now = new Date();
      const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);

      await prisma.mFAAuditLog.create({
        data: {
          userId,
          action: MFAAuditAction.SETUP_INITIATED,
          timestamp: oldDate,
        },
      });

      await auditService.log(userId, MFAAuditAction.SETUP_COMPLETED);

      const deletedCount = await auditService.cleanupOldLogs(90);

      expect(deletedCount).toBe(1);

      const remainingLogs = await prisma.mFAAuditLog.findMany({
        where: { userId },
      });

      expect(remainingLogs).toHaveLength(1);
      expect(remainingLogs[0].action).toBe(MFAAuditAction.SETUP_COMPLETED);
    });

    it('should preserve recent logs', async () => {
      const userId = 'preserve-test';

      for (let i = 0; i < 3; i++) {
        await auditService.log(userId, MFAAuditAction.SETUP_INITIATED);
      }

      const deletedCount = await auditService.cleanupOldLogs(90);

      expect(deletedCount).toBe(0);

      const remainingLogs = await prisma.mFAAuditLog.findMany({
        where: { userId },
      });

      expect(remainingLogs).toHaveLength(3);
    });

    it('should use 90 days as default retention', async () => {
      const userId = 'default-retention-test';
      const now = new Date();
      const eightyDaysAgo = new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000);
      const oneHundredDaysAgo = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);

      await prisma.mFAAuditLog.create({
        data: {
          userId,
          action: MFAAuditAction.SETUP_INITIATED,
          timestamp: eightyDaysAgo,
        },
      });

      await prisma.mFAAuditLog.create({
        data: {
          userId,
          action: MFAAuditAction.VERIFICATION_SUCCESS,
          timestamp: oneHundredDaysAgo,
        },
      });

      const deletedCount = await auditService.cleanupOldLogs();

      expect(deletedCount).toBe(1);
    });
  });

  describe('Factory function', () => {
    it('should create service instance', () => {
      const service = createMFAAuditService(prisma);

      expect(service).toBeInstanceOf(MFAAuditService);
      expect(typeof service.log).toBe('function');
    });
  });
});
