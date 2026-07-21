import { PrismaClient } from '@prisma/client';

export interface SecurityAlert {
  type: 'LOCKOUT' | 'BRUTE_FORCE' | 'RECOVERY_ABUSE' | 'UNUSUAL_PATTERN' | 'VERIFICATION_FAILURE_SPIKE';
  userId: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  message: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

export interface MFAMetrics {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  accountLockouts: number;
  recoveryCodesUsed: number;
  averageVerificationTime?: number; // ms
  successRate: number; // percentage
  lockoutRate: number; // percentage
}

export class MonitoringService {
  constructor(private prisma: PrismaClient) {}

  async getMetricsForTimeWindow(startTime: Date, endTime: Date): Promise<MFAMetrics> {
    const logs = await this.prisma.mFAAuditLog.findMany({
      where: {
        timestamp: {
          gte: startTime,
          lte: endTime,
        },
      },
    });

    const actions = {
      VERIFICATION_SUCCESS: logs.filter((l) => l.action === 'VERIFICATION_SUCCESS').length,
      VERIFICATION_FAILED: logs.filter((l) => l.action === 'VERIFICATION_FAILED').length,
      ACCOUNT_LOCKOUT: logs.filter((l) => l.action === 'ACCOUNT_LOCKOUT').length,
      RECOVERY_CODE_USED: logs.filter((l) => l.action === 'RECOVERY_CODE_USED').length,
    };

    const totalVerifications = actions.VERIFICATION_SUCCESS + actions.VERIFICATION_FAILED;
    const successRate = totalVerifications > 0 ? (actions.VERIFICATION_SUCCESS / totalVerifications) * 100 : 0;
    const lockoutRate = totalVerifications > 0 ? (actions.ACCOUNT_LOCKOUT / totalVerifications) * 100 : 0;

    return {
      totalVerifications,
      successfulVerifications: actions.VERIFICATION_SUCCESS,
      failedVerifications: actions.VERIFICATION_FAILED,
      accountLockouts: actions.ACCOUNT_LOCKOUT,
      recoveryCodesUsed: actions.RECOVERY_CODE_USED,
      successRate: Math.round(successRate * 100) / 100,
      lockoutRate: Math.round(lockoutRate * 100) / 100,
    };
  }

  async detectUserAnomalies(userId: string, lookbackHours: number = 24): Promise<SecurityAlert[]> {
    const alerts: SecurityAlert[] = [];
    const startTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const userLogs = await this.prisma.mFAAuditLog.findMany({
      where: {
        userId,
        timestamp: { gte: startTime },
      },
      orderBy: { timestamp: 'desc' },
    });

    // Check for account lockout
    const lockouts = userLogs.filter((l) => l.action === 'ACCOUNT_LOCKOUT');
    if (lockouts.length > 0) {
      alerts.push({
        type: 'LOCKOUT',
        userId,
        severity: 'HIGH',
        message: `User account locked out (${lockouts.length} lockout(s) in ${lookbackHours}h)`,
        metadata: { lockoutCount: lockouts.length, lastLockout: lockouts[0].timestamp },
        timestamp: new Date(),
      });
    }

    // Check for brute force: >5 failed attempts in 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentFailures = userLogs.filter(
      (l) => l.action === 'VERIFICATION_FAILED' && l.timestamp >= oneHourAgo
    );

    if (recentFailures.length >= 5) {
      alerts.push({
        type: 'BRUTE_FORCE',
        userId,
        severity: 'CRITICAL',
        message: `Potential brute force attack detected (${recentFailures.length} failures in 1h)`,
        metadata: { failureCount: recentFailures.length, timeWindow: '1 hour' },
        timestamp: new Date(),
      });
    }

    // Check for recovery code abuse: >2 usage in 24 hours
    const recoveryUsage = userLogs.filter((l) => l.action === 'RECOVERY_CODE_USED');
    if (recoveryUsage.length >= 2) {
      alerts.push({
        type: 'RECOVERY_ABUSE',
        userId,
        severity: 'MEDIUM',
        message: `Unusual recovery code usage detected (${recoveryUsage.length} uses in ${lookbackHours}h)`,
        metadata: { recoveryUseCount: recoveryUsage.length },
        timestamp: new Date(),
      });
    }

    // Check for verification failure spike: >10 failures in 24 hours
    const failureSpike = userLogs.filter((l) => l.action === 'VERIFICATION_FAILED');
    if (failureSpike.length >= 10) {
      alerts.push({
        type: 'VERIFICATION_FAILURE_SPIKE',
        userId,
        severity: 'HIGH',
        message: `High rate of verification failures (${failureSpike.length} in ${lookbackHours}h)`,
        metadata: { failureCount: failureSpike.length },
        timestamp: new Date(),
      });
    }

    return alerts;
  }

  async getSystemHealthMetrics(): Promise<{
    totalActiveUsers: number;
    totalLockedAccounts: number;
    successRate: number;
    alertsInLastHour: number;
  }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const allLogs = await this.prisma.mFAAuditLog.findMany();
    const recentLogs = await this.prisma.mFAAuditLog.findMany({
      where: { timestamp: { gte: oneHourAgo } },
    });

    const uniqueUsers = new Set(allLogs.map((l) => l.userId)).size;
    const lockedAccounts = new Set(
      allLogs.filter((l) => l.action === 'ACCOUNT_LOCKOUT').map((l) => l.userId)
    ).size;

    const successCount = recentLogs.filter((l) => l.action === 'VERIFICATION_SUCCESS').length;
    const totalCount = recentLogs.filter((l) =>
      ['VERIFICATION_SUCCESS', 'VERIFICATION_FAILED'].includes(l.action)
    ).length;

    const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 100;

    // Count security events (lockouts, failures, recovery usage)
    const alertEvents = recentLogs.filter((l) =>
      ['ACCOUNT_LOCKOUT', 'VERIFICATION_FAILED', 'RECOVERY_CODE_USED'].includes(l.action)
    ).length;

    return {
      totalActiveUsers: uniqueUsers,
      totalLockedAccounts: lockedAccounts,
      successRate: Math.round(successRate * 100) / 100,
      alertsInLastHour: alertEvents,
    };
  }

  async queryMetricsByAction(
    action: string,
    startTime: Date,
    endTime: Date
  ): Promise<{ count: number; uniqueUsers: number; trend: 'increasing' | 'stable' | 'decreasing' }> {
    const logs = await this.prisma.mFAAuditLog.findMany({
      where: {
        action,
        timestamp: { gte: startTime, lte: endTime },
      },
      orderBy: { timestamp: 'desc' },
    });

    const midpoint = new Date((startTime.getTime() + endTime.getTime()) / 2);
    const firstHalf = logs.filter((l) => l.timestamp < midpoint).length;
    const secondHalf = logs.filter((l) => l.timestamp >= midpoint).length;

    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (secondHalf > firstHalf * 1.2) trend = 'increasing';
    else if (secondHalf < firstHalf * 0.8) trend = 'decreasing';

    const uniqueUsers = new Set(logs.map((l) => l.userId)).size;

    return {
      count: logs.length,
      uniqueUsers,
      trend,
    };
  }
}

export function createMonitoringService(prisma: PrismaClient): MonitoringService {
  return new MonitoringService(prisma);
}
