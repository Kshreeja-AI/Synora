import crypto from 'crypto';
import { PrismaClient, MFAStatus } from '@prisma/client';
import { TOTPService } from './totp.service';
import { RecoveryCodeService } from './recovery-code.service';
import { ChallengeTokenService } from './challenge-token.service';
import { SetupTokenService } from './setup-token.service';
import { UnauthorizedException, ConflictException, NotFoundException } from '@synora/shared';

const prisma = new PrismaClient();

export const MFA_CONFIG = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
  ATTEMPT_RATE_LIMIT: 10, // per 10 minutes
};

/**
 * MFA Service
 * Orchestrates TOTP, recovery codes, and challenge tokens
 */
export class MFAService {
  /**
   * Check if user has MFA enabled
   */
  static async isEnabled(userId: string): Promise<boolean> {
    const method = await prisma.mFAMethod.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    });

    return method?.status === 'ACTIVE' || method?.status === 'RECOVERY_MODE';
  }

  /**
   * Get MFA status for user
   */
  static async getStatus(userId: string) {
    const method = await prisma.mFAMethod.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    });

    if (!method) {
      return {
        enabled: false,
        type: null,
        status: null,
      };
    }

    // Count remaining recovery codes
    const recoveryCodesUsed = await prisma.mFARecoveryCode.count({
      where: {
        mfaMethodId: method.id,
        usedAt: { not: null },
      },
    });

    const recoveryCodesTotal = method.backupCodesHash.length;
    const recoveryCodesRemaining = recoveryCodesTotal - recoveryCodesUsed;

    return {
      enabled: method.status === 'ACTIVE' || method.status === 'RECOVERY_MODE',
      type: method.type,
      status: method.status,
      enabledAt: method.enabledAt,
      lastUsedAt: method.lastUsedAt,
      recoveryCodesRemaining,
      recoveryCodesTotal,
    };
  }

  /**
   * Start MFA setup
   * Returns setup token + secret for QR code
   */
  static async startSetup(userId: string) {
    // Check if already has active MFA
    const existing = await prisma.mFAMethod.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    });

    if (existing && existing.status === 'ACTIVE') {
      throw new ConflictException('MFA is already enabled');
    }

    // Create setup token
    const { token, secret, uri, expiresAt } = await SetupTokenService.createToken(userId);

    return {
      setupToken: token,
      secret,
      qrCode: uri,
      expiresAt,
    };
  }

  /**
   * Verify TOTP code during setup
   * User has entered code from authenticator
   */
  static async verifySetupCode(userId: string, setupToken: string, code: string) {
    // Verify token + code
    const verified = await SetupTokenService.verifyToken(setupToken, code, userId);

    if (!verified) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Generate recovery codes
    const pairs = RecoveryCodeService.generateCodeHashPairs(10);

    return {
      recoveryCodes: pairs.map((p) => p.code), // Show plaintext to user
      codeHashes: pairs.map((p) => p.hash), // Store hashes
      setupToken, // For confirmation step
    };
  }

  /**
   * Confirm MFA setup completion
   * Creates MFAMethod + recovery codes in database
   */
  static async confirmSetup(userId: string, setupToken: string, recoveryCodes: string[]) {
    const setupTokenData = await SetupTokenService.getVerified(setupToken, userId);

    if (!setupTokenData) {
      throw new UnauthorizedException('Setup token invalid or expired');
    }

    // Create MFAMethod atomically with recovery codes
    const mfaMethod = await prisma.mFAMethod.create({
      data: {
        userId,
        type: 'TOTP',
        status: 'ACTIVE',
        secret: setupTokenData.secret,
        backupCodesHash: recoveryCodes,
        enabledAt: new Date(),
      },
    });

    // Create recovery code records for audit trail
    await Promise.all(
      recoveryCodes.map((hash) =>
        prisma.mFARecoveryCode.create({
          data: {
            mfaMethodId: mfaMethod.id,
            codeHash: hash,
          },
        })
      )
    );

    // Clean up setup token
    await SetupTokenService.deleteToken(
      crypto.createHash('sha256').update(setupToken).digest('hex')
    );

    return { success: true };
  }

  /**
   * Generate MFA challenge token after password verification
   * User needs to enter TOTP code to complete login
   */
  static async generateChallenge(
    userId: string,
    sessionId: string,
    ipAddress: string,
    userAgent: string
  ) {
    const { token, expiresAt } = await ChallengeTokenService.generateToken(
      userId,
      sessionId,
      ipAddress,
      userAgent
    );

    return { mfaChallengeToken: token, expiresAt };
  }

  /**
   * Verify TOTP code during login
   * User has entered 6-digit code from authenticator
   */
  static async verifyChallengeCode(
    userId: string,
    challengeToken: string,
    code: string
  ): Promise<{ success: boolean; message?: string }> {
    // Verify challenge token exists + valid
    const tokenData = await ChallengeTokenService.verifyToken(challengeToken, userId);

    if (!tokenData) {
      throw new UnauthorizedException('Challenge token invalid or expired');
    }

    // Get user's MFA method
    const mfaMethod = await prisma.mFAMethod.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    });

    if (!mfaMethod || mfaMethod.status !== 'ACTIVE') {
      throw new NotFoundException('MFA not enabled');
    }

    // Check if locked out
    const isLocked = await this.isLockedOut(mfaMethod.id);
    if (isLocked) {
      throw new UnauthorizedException('Too many failed attempts. Try again later.');
    }

    // Verify TOTP code
    const isValid = TOTPService.verify(code, mfaMethod.secret);

    // Record attempt
    await prisma.mFAAttempt.create({
      data: {
        mfaMethodId: mfaMethod.id,
        code: code.slice(-4), // Log last 4 digits only
        success: isValid,
      },
    });

    if (!isValid) {
      // Check failure count
      const recentFailures = await prisma.mFAAttempt.count({
        where: {
          mfaMethodId: mfaMethod.id,
          success: false,
          createdAt: {
            gte: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
          },
        },
      });

      if (recentFailures >= MFA_CONFIG.MAX_FAILED_ATTEMPTS) {
        // Lock account
        await prisma.mFAMethod.update({
          where: { id: mfaMethod.id },
          data: { status: 'RECOVERY_MODE' },
        });
      }

      throw new UnauthorizedException('Invalid MFA code');
    }

    // Update last used
    await prisma.mFAMethod.update({
      where: { id: mfaMethod.id },
      data: { lastUsedAt: new Date() },
    });

    // Consume challenge token
    await ChallengeTokenService.consumeToken(tokenData.id);

    return { success: true };
  }

  /**
   * Verify recovery code during login
   * User is using backup code (lost authenticator scenario)
   */
  static async verifyChallengeRecoveryCode(
    userId: string,
    challengeToken: string,
    recoveryCode: string
  ): Promise<{ success: boolean; warning: string }> {
    // Verify challenge token
    const tokenData = await ChallengeTokenService.verifyToken(challengeToken, userId);

    if (!tokenData) {
      throw new UnauthorizedException('Challenge token invalid or expired');
    }

    // Validate recovery code format
    if (!RecoveryCodeService.isValidFormat(recoveryCode)) {
      throw new UnauthorizedException('Invalid recovery code format');
    }

    // Get MFA method
    const mfaMethod = await prisma.mFAMethod.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    });

    if (!mfaMethod) {
      throw new NotFoundException('MFA not enabled');
    }

    // Find matching recovery code
    const codeIndex = mfaMethod.backupCodesHash.findIndex((hash) =>
      RecoveryCodeService.verifyCode(recoveryCode, hash)
    );

    if (codeIndex === -1) {
      throw new UnauthorizedException('Invalid recovery code');
    }

    // Mark recovery code as used
    const recoveryCodeRecord = await prisma.mFARecoveryCode.findFirst({
      where: {
        mfaMethodId: mfaMethod.id,
        codeHash: mfaMethod.backupCodesHash[codeIndex],
      },
    });

    if (recoveryCodeRecord?.usedAt) {
      throw new UnauthorizedException('Recovery code already used');
    }

    await prisma.mFARecoveryCode.update({
      where: { id: recoveryCodeRecord!.id },
      data: { usedAt: new Date() },
    });

    // Update MFA method status to RECOVERY_MODE (user lost device)
    await prisma.mFAMethod.update({
      where: { id: mfaMethod.id },
      data: { status: 'RECOVERY_MODE', lastUsedAt: new Date() },
    });

    // Consume challenge token
    await ChallengeTokenService.consumeToken(tokenData.id);

    return {
      success: true,
      warning: 'Recovery code used. You have 48 hours to re-enable MFA with a new device.',
    };
  }

  /**
   * Disable MFA
   */
  static async disable(userId: string): Promise<{ success: boolean }> {
    await prisma.mFAMethod.updateMany({
      where: { userId },
      data: { status: 'DISABLED' },
    });

    return { success: true };
  }

  /**
   * Check if account is locked out
   */
  private static async isLockedOut(mfaMethodId: string): Promise<boolean> {
    const recentFailures = await prisma.mFAAttempt.count({
      where: {
        mfaMethodId,
        success: false,
        createdAt: {
          gte: new Date(Date.now() - MFA_CONFIG.LOCKOUT_DURATION),
        },
      },
    });

    return recentFailures >= MFA_CONFIG.MAX_FAILED_ATTEMPTS;
  }

  /**
   * Get recovery codes for user (with masking)
   */
  static async getRecoveryCodes(userId: string) {
    const mfaMethod = await prisma.mFAMethod.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    });

    if (!mfaMethod) {
      return { codes: [] };
    }

    const codesWithStatus = await prisma.mFARecoveryCode.findMany({
      where: { mfaMethodId: mfaMethod.id },
    });

    return {
      codes: codesWithStatus.map((c) => ({
        codeHash: c.codeHash,
        prefix: c.codeHash.substring(0, 8), // Show first 8 chars of hash as ID
        usedAt: c.usedAt,
      })),
    };
  }
}
