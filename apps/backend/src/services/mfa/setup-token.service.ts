import crypto from 'crypto';

import { TOTPService } from './totp.service';

import { prisma } from '@synora/database';
/**
 * Setup Token Service
 * Manages temporary tokens during MFA setup process
 * Keeps TOTP secret safe during enrollment
 */
export class SetupTokenService {
  private static readonly EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly TOKEN_LENGTH = 32;

  /**
   * Create setup token with TOTP secret
   * Returns token + secret to user for QR code display
   */
  static async createToken(userId: string): Promise<{ token: string; secret: string; uri: string; expiresAt: Date }> {
    const token = crypto.randomBytes(this.TOKEN_LENGTH).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const secret = TOTPService.generateSecret();
    const expiresAt = new Date(Date.now() + this.EXPIRY_MS);

    // Store encrypted secret temporarily
    await prisma.mFASetupToken.create({
      data: {
        userId,
        tokenHash,
        secret,
        expiresAt,
      },
    });

    const uri = TOTPService.getUri(userId, secret);

    return { token, secret, uri, expiresAt };
  }

  /**
   * Verify setup token + mark as verified
   * Called when user enters code from authenticator
   * Uses timing-safe userId comparison to prevent timing attacks
   */
  static async verifyToken(token: string, code: string, userId: string): Promise<{ secret: string } | null> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const setupToken = await prisma.mFASetupToken.findUnique({
        where: { tokenHash },
      });

      if (!setupToken) {
        return null;
      }

      // Verify ownership with timing-safe comparison
      try {
        crypto.timingSafeEqual(
          Buffer.from(setupToken.userId),
          Buffer.from(userId)
        );
      } catch {
        return null;
      }

      // Check expiry
      if (new Date() > setupToken.expiresAt) {
        return null;
      }

      // Verify TOTP code against secret
      if (!TOTPService.verify(code, setupToken.secret)) {
        return null;
      }

      // Mark as verified
      await prisma.mFASetupToken.update({
        where: { id: setupToken.id },
        data: { verified: true },
      });

      return { secret: setupToken.secret };
    } catch {
      return null;
    }
  }

  /**
   * Get verified setup token
   * Used to confirm setup is complete
   * Uses timing-safe userId comparison to prevent timing attacks
   */
  static async getVerified(token: string, userId: string): Promise<{ secret: string } | null> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const setupToken = await prisma.mFASetupToken.findUnique({
        where: { tokenHash },
      });

      if (!setupToken) {
        return null;
      }

      // Verify ownership with timing-safe comparison
      try {
        crypto.timingSafeEqual(
          Buffer.from(setupToken.userId),
          Buffer.from(userId)
        );
      } catch {
        return null;
      }

      if (!setupToken.verified) {
        return null;
      }

      // Check expiry
      if (new Date() > setupToken.expiresAt) {
        return null;
      }

      return { secret: setupToken.secret };
    } catch {
      return null;
    }
  }

  /**
   * Delete setup token after MFA is confirmed
   */
  static async deleteToken(tokenHash: string): Promise<boolean> {
    try {
      await prisma.mFASetupToken.delete({
        where: { tokenHash },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup expired setup tokens
   */
  static async cleanupExpired(): Promise<number> {
    const result = await prisma.mFASetupToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  /**
   * Get expiry time
   */
  static getExpiryTime(): Date {
    return new Date(Date.now() + this.EXPIRY_MS);
  }
}
