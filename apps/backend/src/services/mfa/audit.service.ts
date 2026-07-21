import { Prisma, PrismaClient } from '@prisma/client';

interface AuditLogMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export enum MFAAuditAction {
  SETUP_INITIATED = 'SETUP_INITIATED',
  SETUP_COMPLETED = 'SETUP_COMPLETED',
  SETUP_CANCELLED = 'SETUP_CANCELLED',
  VERIFICATION_STARTED = 'VERIFICATION_STARTED',
  VERIFICATION_SUCCESS = 'VERIFICATION_SUCCESS',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  RECOVERY_CODE_USED = 'RECOVERY_CODE_USED',
  DISABLED = 'DISABLED',
  METHOD_REMOVED = 'METHOD_REMOVED',
  ACCOUNT_LOCKOUT = 'ACCOUNT_LOCKOUT',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
}

/**
 * MFAAuditService handles structured logging of all MFA-related events.
 * Used for compliance, incident investigation, and security monitoring.
 */
export class MFAAuditService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Log an MFA event with optional metadata.
   * All logs are persisted immediately for audit trail consistency.
   */
  async log(userId: string, action: MFAAuditAction | string, metadata?: AuditLogMetadata): Promise<void> {
    try {
      await this.prisma.mFAAuditLog.create({
        data: {
          userId,
          action,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error('[MFAAuditService] Failed to log audit event:', { userId, action, error });
      throw error;
    }
  }

  /**
   * Query audit logs for a specific user.
   * Returns logs in reverse chronological order (most recent first).
   */
  async getUserLogs(userId: string, limit: number = 100): Promise<any[]> {
    return this.prisma.mFAAuditLog.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Query audit logs by action type.
   * Useful for investigating specific types of MFA events.
   */
  async getLogsByAction(action: string, limit: number = 100): Promise<any[]> {
    return this.prisma.mFAAuditLog.findMany({
      where: { action },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Get audit logs within a time range.
   * Useful for compliance reporting and incident investigation.
   */
  async getLogsByTimeRange(startTime: Date, endTime: Date, limit: number = 1000): Promise<any[]> {
    return this.prisma.mFAAuditLog.findMany({
      where: {
        timestamp: {
          gte: startTime,
          lte: endTime,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Get security events (verification failures, lockouts) for a user.
   * Used for anomaly detection and security alerting.
   */
  async getUserSecurityEvents(userId: string, hoursLookback: number = 24): Promise<any[]> {
    const startTime = new Date(Date.now() - hoursLookback * 60 * 60 * 1000);
    const securityActions = [
      MFAAuditAction.VERIFICATION_FAILED,
      MFAAuditAction.ACCOUNT_LOCKOUT,
      MFAAuditAction.RECOVERY_CODE_USED,
    ];

    return this.prisma.mFAAuditLog.findMany({
      where: {
        userId,
        action: { in: securityActions },
        timestamp: { gte: startTime },
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * Count failed verification attempts for a user in a time window.
   * Used for rate limiting and brute force detection.
   */
  async countFailedVerificationAttempts(userId: string, minutesLookback: number = 60): Promise<number> {
    const startTime = new Date(Date.now() - minutesLookback * 60 * 1000);

    const result = await this.prisma.mFAAuditLog.count({
      where: {
        userId,
        action: MFAAuditAction.VERIFICATION_FAILED,
        timestamp: { gte: startTime },
      },
    });

    return result;
  }

  /**
   * Delete audit logs older than a retention period.
   * Used for compliance with data retention policies.
   * Default: 90 days retention.
   */
  async cleanupOldLogs(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.mFAAuditLog.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    console.log(`[MFAAuditService] Cleaned up ${result.count} audit logs older than ${retentionDays} days`);
    return result.count;
  }
}

/**
 * Factory function to create MFAAuditService with Prisma client.
 */
export function createMFAAuditService(prisma: PrismaClient): MFAAuditService {
  return new MFAAuditService(prisma);
}
