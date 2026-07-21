import { PrismaClient } from '@prisma/client';

export interface RateLimitStatus {
  isRateLimited: boolean;
  remainingAttempts: number;
  lockoutUntil?: Date;
  reason?: string;
}

export interface RateLimitConfig {
  maxAttemptsPerWindow: number; // e.g., 5 attempts
  windowMinutes: number; // e.g., 15 minutes
  lockoutMinutes: number; // e.g., 30 minutes
  progressiveLockout: boolean; // Increase lockout time with each violation
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttemptsPerWindow: 5,
  windowMinutes: 15,
  lockoutMinutes: 30,
  progressiveLockout: true,
};

export class RateLimiterService {
  private config: RateLimitConfig;

  constructor(private prisma: PrismaClient, config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async checkVerificationAttempt(userId: string): Promise<RateLimitStatus> {
    const windowStart = new Date(Date.now() - this.config.windowMinutes * 60 * 1000);

    // Count failed attempts in the window
    const recentFailures = await this.prisma.mFAAuditLog.count({
      where: {
        userId,
        action: 'VERIFICATION_FAILED',
        timestamp: { gte: windowStart },
      },
    });

    // Check if user is currently locked out
    const lockoutLogs = await this.prisma.mFAAuditLog.findMany({
      where: {
        userId,
        action: 'ACCOUNT_LOCKOUT',
      },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });

    if (lockoutLogs.length > 0) {
      const lastLockout = lockoutLogs[0];
      const lockoutEnd = new Date(lastLockout.timestamp.getTime() + this.config.lockoutMinutes * 60 * 1000);

      if (new Date() < lockoutEnd) {
        return {
          isRateLimited: true,
          remainingAttempts: 0,
          lockoutUntil: lockoutEnd,
          reason: 'Account is locked due to too many failed attempts',
        };
      }
    }

    // Check if within rate limit
    if (recentFailures >= this.config.maxAttemptsPerWindow) {
      return {
        isRateLimited: true,
        remainingAttempts: 0,
        reason: `Exceeded maximum verification attempts (${this.config.maxAttemptsPerWindow} per ${this.config.windowMinutes} min)`,
      };
    }

    const remainingAttempts = this.config.maxAttemptsPerWindow - recentFailures;

    return {
      isRateLimited: false,
      remainingAttempts,
    };
  }

  async checkRecoveryCodeAttempt(userId: string): Promise<RateLimitStatus> {
    // Recovery codes are more sensitive - allow fewer attempts
    const recoveryWindowMinutes = this.config.windowMinutes * 2; // 2x stricter window
    const maxRecoveryAttempts = this.config.maxAttemptsPerWindow / 2; // 2x fewer attempts

    const windowStart = new Date(Date.now() - recoveryWindowMinutes * 60 * 1000);

    const recentFailures = await this.prisma.mFAAuditLog.count({
      where: {
        userId,
        action: 'VERIFICATION_FAILED',
        timestamp: { gte: windowStart },
      },
    });

    if (recentFailures >= maxRecoveryAttempts) {
      return {
        isRateLimited: true,
        remainingAttempts: 0,
        reason: `Exceeded maximum recovery code attempts (${maxRecoveryAttempts} per ${recoveryWindowMinutes} min)`,
      };
    }

    return {
      isRateLimited: false,
      remainingAttempts: Math.max(0, maxRecoveryAttempts - recentFailures),
    };
  }

  async getProgressiveLockoutDuration(userId: string): Promise<number> {
    if (!this.config.progressiveLockout) {
      return this.config.lockoutMinutes;
    }

    // Get count of ACCOUNT_LOCKOUT events in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const lockoutCount = await this.prisma.mFAAuditLog.count({
      where: {
        userId,
        action: 'ACCOUNT_LOCKOUT',
        timestamp: { gte: sevenDaysAgo },
      },
    });

    // Progressive: 30min, 60min, 120min, etc.
    const multiplier = Math.min(lockoutCount, 5); // Cap at 5x
    return this.config.lockoutMinutes * Math.pow(2, multiplier - 1);
  }

  async isIpRateLimited(ipAddress: string): Promise<RateLimitStatus> {
    // Rate limit by IP for signup/registration attempts
    const windowStart = new Date(Date.now() - 60 * 60 * 1000); // 1 hour window

    const logsFromIp = await this.prisma.mFAAuditLog.findMany({
      where: {
        timestamp: { gte: windowStart },
      },
    });

    // Parse metadata to find IP addresses (if logged)
    const ipsFromLogs = logsFromIp
      .filter((log) => {
        try {
          const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
          return meta?.ipAddress === ipAddress;
        } catch {
          return false;
        }
      })
      .length;

    const maxIpAttempts = 20; // 20 attempts per IP per hour
    if (ipsFromLogs >= maxIpAttempts) {
      return {
        isRateLimited: true,
        remainingAttempts: 0,
        reason: 'IP address rate limited',
      };
    }

    return {
      isRateLimited: false,
      remainingAttempts: maxIpAttempts - ipsFromLogs,
    };
  }

  async clearLockout(userId: string): Promise<void> {
    // Soft-clear: add ACCOUNT_UNLOCKED event
    // The rate limiter checks if lockout is still active based on timestamp + duration
    // This is for admin unlock capability
    await this.prisma.mFAAuditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_UNLOCKED',
        timestamp: new Date(),
      },
    });
  }

  async getAttemptHistory(userId: string, limit: number = 10): Promise<Array<{
    timestamp: Date;
    action: string;
    success: boolean;
  }>> {
    const logs = await this.prisma.mFAAuditLog.findMany({
      where: {
        userId,
        action: { in: ['VERIFICATION_SUCCESS', 'VERIFICATION_FAILED', 'ACCOUNT_LOCKOUT'] },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return logs.map((log) => ({
      timestamp: log.timestamp,
      action: log.action,
      success: log.action === 'VERIFICATION_SUCCESS',
    }));
  }
}

export function createRateLimiterService(
  prisma: PrismaClient,
  config?: Partial<RateLimitConfig>
): RateLimiterService {
  return new RateLimiterService(prisma, config);
}
