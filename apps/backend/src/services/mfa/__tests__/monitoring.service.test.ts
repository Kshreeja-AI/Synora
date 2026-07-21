import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MonitoringService, createMonitoringService } from '../monitoring.service';

describe('MonitoringService', () => {
  let prisma: PrismaClient;
  let monitoringService: MonitoringService;

  beforeAll(() => {
    prisma = new PrismaClient();
    monitoringService = createMonitoringService(prisma);
  });

  afterAll(async () => {
    await prisma.mFAAuditLog.deleteMany({});
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.mFAAuditLog.deleteMany({});
  });

  describe('getMetricsForTimeWindow()', () => {
    it('should calculate metrics for time window', async () => {
      const userId = 'user-metrics-1';
      const startTime = new Date(Date.now() - 60 * 60 * 1000);
      const endTime = new Date(Date.now() + 60 * 1000);

      // Create verification logs
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
      });

      const metrics = await monitoringService.getMetricsForTimeWindow(startTime, endTime);

      expect(metrics.totalVerifications).toBe(3);
      expect(metrics.successfulVerifications).toBe(2);
      expect(metrics.failedVerifications).toBe(1);
      expect(metrics.successRate).toBeCloseTo(66.67, 1);
    });

    it('should handle empty time window', async () => {
      const startTime = new Date(Date.now() - 100 * 60 * 60 * 1000);
      const endTime = new Date(Date.now() - 50 * 60 * 60 * 1000);

      const metrics = await monitoringService.getMetricsForTimeWindow(startTime, endTime);

      expect(metrics.totalVerifications).toBe(0);
      expect(metrics.successfulVerifications).toBe(0);
      expect(metrics.successRate).toBe(0);
    });

    it('should count lockouts and recovery usage', async () => {
      const userId = 'user-metrics-2';
      const startTime = new Date(Date.now() - 60 * 60 * 1000);
      const endTime = new Date(Date.now() + 60 * 1000);

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'RECOVERY_CODE_USED', timestamp: new Date() },
      });

      const metrics = await monitoringService.getMetricsForTimeWindow(startTime, endTime);

      expect(metrics.accountLockouts).toBe(1);
      expect(metrics.recoveryCodesUsed).toBe(1);
    });

    it('should calculate lockout rate', async () => {
      const userId = 'user-metrics-3';
      const startTime = new Date(Date.now() - 60 * 60 * 1000);
      const endTime = new Date(Date.now() + 60 * 1000);

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });

      const metrics = await monitoringService.getMetricsForTimeWindow(startTime, endTime);

      expect(metrics.lockoutRate).toBeCloseTo(50, 1);
    });
  });

  describe('detectUserAnomalies()', () => {
    it('should detect account lockout', async () => {
      const userId = 'user-anomaly-1';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });

      const alerts = await monitoringService.detectUserAnomalies(userId);

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.some((a) => a.type === 'LOCKOUT')).toBe(true);
    });

    it('should detect brute force (>5 failures in 1 hour)', async () => {
      const userId = 'user-anomaly-2';

      for (let i = 0; i < 6; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const alerts = await monitoringService.detectUserAnomalies(userId);

      expect(alerts.some((a) => a.type === 'BRUTE_FORCE')).toBe(true);
      expect(alerts.some((a) => a.severity === 'CRITICAL')).toBe(true);
    });

    it('should not flag <5 failures in 1 hour as brute force', async () => {
      const userId = 'user-anomaly-3';

      for (let i = 0; i < 3; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const alerts = await monitoringService.detectUserAnomalies(userId);

      expect(alerts.some((a) => a.type === 'BRUTE_FORCE')).toBe(false);
    });

    it('should detect recovery code abuse (>=2 uses in 24h)', async () => {
      const userId = 'user-anomaly-4';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'RECOVERY_CODE_USED', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'RECOVERY_CODE_USED', timestamp: new Date() },
      });

      const alerts = await monitoringService.detectUserAnomalies(userId);

      expect(alerts.some((a) => a.type === 'RECOVERY_ABUSE')).toBe(true);
    });

    it('should detect verification failure spike (>=10 in 24h)', async () => {
      const userId = 'user-anomaly-5';

      for (let i = 0; i < 11; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
        });
      }

      const alerts = await monitoringService.detectUserAnomalies(userId);

      expect(alerts.some((a) => a.type === 'VERIFICATION_FAILURE_SPIKE')).toBe(true);
    });

    it('should respect lookback window', async () => {
      const userId = 'user-anomaly-6';
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: oldTime },
      });

      // lookback 24 hours should not see the 48-hour-old event
      const alerts = await monitoringService.detectUserAnomalies(userId, 24);

      expect(alerts.some((a) => a.type === 'LOCKOUT')).toBe(false);
    });
  });

  describe('getSystemHealthMetrics()', () => {
    it('should return system health data', async () => {
      const userId1 = 'user-health-1';
      const userId2 = 'user-health-2';

      await prisma.mFAAuditLog.create({
        data: { userId: userId1, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId: userId2, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId: userId1, action: 'VERIFICATION_FAILED', timestamp: new Date() },
      });

      const health = await monitoringService.getSystemHealthMetrics();

      expect(health.totalActiveUsers).toBeGreaterThanOrEqual(2);
      expect(health.successRate).toBeGreaterThan(0);
    });

    it('should count locked accounts', async () => {
      const userId = 'user-health-locked';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });

      const health = await monitoringService.getSystemHealthMetrics();

      expect(health.totalLockedAccounts).toBeGreaterThanOrEqual(1);
    });

    it('should count alerts in last hour', async () => {
      const userId = 'user-health-alerts';

      await prisma.mFAAuditLog.create({
        data: { userId, action: 'ACCOUNT_LOCKOUT', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date() },
      });

      const health = await monitoringService.getSystemHealthMetrics();

      expect(health.alertsInLastHour).toBeGreaterThanOrEqual(2);
    });
  });

  describe('queryMetricsByAction()', () => {
    it('should return count and unique users for action', async () => {
      const user1 = 'user-action-1';
      const user2 = 'user-action-2';
      const startTime = new Date(Date.now() - 60 * 60 * 1000);
      const endTime = new Date(Date.now() + 60 * 1000);

      await prisma.mFAAuditLog.create({
        data: { userId: user1, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });
      await prisma.mFAAuditLog.create({
        data: { userId: user2, action: 'VERIFICATION_SUCCESS', timestamp: new Date() },
      });

      const metrics = await monitoringService.queryMetricsByAction('VERIFICATION_SUCCESS', startTime, endTime);

      expect(metrics.count).toBe(2);
      expect(metrics.uniqueUsers).toBe(2);
    });

    it('should detect trend: increasing', async () => {
      const userId = 'user-trend-1';
      const startTime = new Date(Date.now() - 60 * 60 * 1000);
      const midpoint = new Date((startTime.getTime() + Date.now()) / 2);
      const endTime = new Date(Date.now() + 60 * 1000);

      // Add logs in first half
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date(midpoint.getTime() - 10 * 60 * 1000) },
      });

      // Add more logs in second half
      for (let i = 0; i < 5; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date(midpoint.getTime() + 10 * 60 * 1000) },
        });
      }

      const metrics = await monitoringService.queryMetricsByAction('VERIFICATION_FAILED', startTime, endTime);

      expect(metrics.trend).toBe('increasing');
    });

    it('should detect trend: decreasing', async () => {
      const userId = 'user-trend-2';
      const startTime = new Date(Date.now() - 60 * 60 * 1000);
      const midpoint = new Date((startTime.getTime() + Date.now()) / 2);
      const endTime = new Date(Date.now() + 60 * 1000);

      // Add many logs in first half
      for (let i = 0; i < 5; i++) {
        await prisma.mFAAuditLog.create({
          data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date(midpoint.getTime() - 10 * 60 * 1000) },
        });
      }

      // Add fewer logs in second half
      await prisma.mFAAuditLog.create({
        data: { userId, action: 'VERIFICATION_FAILED', timestamp: new Date(midpoint.getTime() + 10 * 60 * 1000) },
      });

      const metrics = await monitoringService.queryMetricsByAction('VERIFICATION_FAILED', startTime, endTime);

      expect(metrics.trend).toBe('decreasing');
    });
  });

  describe('Factory function', () => {
    it('should create service instance', () => {
      const service = createMonitoringService(prisma);

      expect(service).toBeInstanceOf(MonitoringService);
      expect(typeof service.getMetricsForTimeWindow).toBe('function');
    });
  });
});
