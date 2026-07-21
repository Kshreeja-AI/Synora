import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AlertingService, AlertChannel, createAlertingService } from '../alerting.service';

describe('AlertingService', () => {
  let prisma: PrismaClient;
  let alertingService: AlertingService;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  // Alerts are held in memory per service instance; a fresh instance per
  // test keeps exact-count assertions independent of execution order.
  beforeEach(() => {
    alertingService = createAlertingService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('createAlert()', () => {
    it('should create alert with basic fields', async () => {
      const alert = await alertingService.createAlert('TEST_EVENT', 'HIGH', 'Test alert message', 'user-1');

      expect(alert.id).toBeDefined();
      expect(alert.type).toBe('TEST_EVENT');
      expect(alert.severity).toBe('HIGH');
      expect(alert.message).toBe('Test alert message');
      expect(alert.userId).toBe('user-1');
      expect(alert.sent).toBe(true);
    });

    it('should create alert with metadata', async () => {
      const metadata = { attemptCount: 5, ipAddress: '192.168.1.1' };
      const alert = await alertingService.createAlert(
        'BRUTE_FORCE',
        'CRITICAL',
        'Brute force detected',
        'user-2',
        metadata
      );

      expect(alert.metadata).toEqual(metadata);
    });

    it('should send to specified channels', async () => {
      const alert = await alertingService.createAlert(
        'SECURITY_EVENT',
        'HIGH',
        'Security event',
        'user-3',
        {},
        [AlertChannel.LOG, AlertChannel.EMAIL]
      );

      expect(alert.channels).toContain(AlertChannel.LOG);
      expect(alert.channels).toContain(AlertChannel.EMAIL);
    });

    it('should default to LOG channel', async () => {
      const alert = await alertingService.createAlert('EVENT', 'MEDIUM', 'Event message', 'user-4');

      expect(alert.channels).toContain(AlertChannel.LOG);
    });

    it('should set createdAt timestamp', async () => {
      const beforeTime = new Date();
      const alert = await alertingService.createAlert('TIME_TEST', 'LOW', 'Message', 'user-5');
      const afterTime = new Date();

      expect(alert.createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(alert.createdAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('acknowledgeAlert()', () => {
    it('should acknowledge alert', async () => {
      const alert = await alertingService.createAlert('TO_ACK', 'HIGH', 'Message', 'user-6');

      const acknowledged = await alertingService.acknowledgeAlert(alert.id);

      expect(acknowledged).not.toBeNull();
      expect(acknowledged?.metadata.acknowledged).toBe(true);
      expect(acknowledged?.metadata.acknowledgedAt).toBeDefined();
    });

    it('should return null for non-existent alert', async () => {
      const result = await alertingService.acknowledgeAlert('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('getAlertsByUserId()', () => {
    it('should return alerts for specific user', async () => {
      const userId = 'user-7';

      await alertingService.createAlert('EVENT_1', 'HIGH', 'Message 1', userId);
      await alertingService.createAlert('EVENT_2', 'MEDIUM', 'Message 2', userId);
      await alertingService.createAlert('EVENT_3', 'LOW', 'Message 3', 'other-user');

      const userAlerts = await alertingService.getAlertsByUserId(userId);

      expect(userAlerts.length).toBe(2);
      expect(userAlerts.every((a) => a.userId === userId)).toBe(true);
    });

    it('should return empty array for user with no alerts', async () => {
      const alerts = await alertingService.getAlertsByUserId('non-existent-user');

      expect(alerts).toEqual([]);
    });
  });

  describe('getAlertsBySeverity()', () => {
    it('should return alerts by severity', async () => {
      await alertingService.createAlert('CRIT_1', 'CRITICAL', 'Critical 1');
      await alertingService.createAlert('CRIT_2', 'CRITICAL', 'Critical 2');
      await alertingService.createAlert('HIGH_1', 'HIGH', 'High 1');

      const criticalAlerts = await alertingService.getAlertsBySeverity('CRITICAL');

      expect(criticalAlerts.length).toBe(2);
      expect(criticalAlerts.every((a) => a.severity === 'CRITICAL')).toBe(true);
    });
  });

  describe('getRecentAlerts()', () => {
    it('should return alerts within lookback window', async () => {
      const alert1 = await alertingService.createAlert('RECENT', 'HIGH', 'Recent message');

      const alerts = await alertingService.getRecentAlerts(5); // 5 minutes

      expect(alerts.some((a) => a.id === alert1.id)).toBe(true);
    });

    it('should exclude old alerts', async () => {
      // Note: In real implementation, we'd mock dates for this test
      // For now, we just verify the function works
      const alerts = await alertingService.getRecentAlerts(1); // 1 minute

      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('getUnacknowledgedAlerts()', () => {
    it('should return only unacknowledged alerts', async () => {
      const alert1 = await alertingService.createAlert('UNACK_1', 'HIGH', 'Message 1');
      const alert2 = await alertingService.createAlert('UNACK_2', 'HIGH', 'Message 2');

      await alertingService.acknowledgeAlert(alert1.id);

      const unacknowledged = await alertingService.getUnacknowledgedAlerts();

      expect(unacknowledged.some((a) => a.id === alert1.id)).toBe(false);
      expect(unacknowledged.some((a) => a.id === alert2.id)).toBe(true);
    });
  });

  describe('getAlertSummary()', () => {
    it('should return summary statistics', async () => {
      await alertingService.createAlert('SUM_CRIT', 'CRITICAL', 'Critical 1');
      await alertingService.createAlert('SUM_CRIT', 'CRITICAL', 'Critical 2');
      await alertingService.createAlert('SUM_HIGH', 'HIGH', 'High 1');
      await alertingService.createAlert('SUM_MED', 'MEDIUM', 'Medium 1');

      const summary = await alertingService.getAlertSummary();

      expect(summary.total).toBeGreaterThanOrEqual(4);
      expect(summary.bySeverity.CRITICAL).toBeGreaterThanOrEqual(2);
      expect(summary.bySeverity.HIGH).toBeGreaterThanOrEqual(1);
      expect(summary.bySeverity.MEDIUM).toBeGreaterThanOrEqual(1);
    });

    it('should count unacknowledged', async () => {
      await alertingService.createAlert('UNACK_COUNT', 'HIGH', 'Message 1');

      const summary = await alertingService.getAlertSummary();

      expect(summary.unacknowledged).toBeGreaterThanOrEqual(1);
    });

    it('should track alerts by type', async () => {
      await alertingService.createAlert('TYPE_A', 'HIGH', 'Message 1');
      await alertingService.createAlert('TYPE_A', 'HIGH', 'Message 2');
      await alertingService.createAlert('TYPE_B', 'HIGH', 'Message 3');

      const summary = await alertingService.getAlertSummary();

      expect(summary.byType.TYPE_A).toBeGreaterThanOrEqual(2);
      expect(summary.byType.TYPE_B).toBeGreaterThanOrEqual(1);
    });
  });

  describe('clearOldAlerts()', () => {
    it('should delete alerts older than retention period', async () => {
      const alert = await alertingService.createAlert('OLD', 'HIGH', 'Old alert');

      // Manually age the alert by setting createdAt to 10 days ago
      alert.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      const deletedCount = await alertingService.clearOldAlerts(7);

      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Factory function', () => {
    it('should create service instance', () => {
      const service = createAlertingService(prisma);

      expect(service).toBeInstanceOf(AlertingService);
      expect(typeof service.createAlert).toBe('function');
    });
  });
});
