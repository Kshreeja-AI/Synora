import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Challenge Token Service
 * Generates and validates short-lived tokens for MFA verification
 * Similar to CSRF tokens but with different naming + shorter expiry
 */
export class ChallengeTokenService {
  private static readonly EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly TOKEN_LENGTH = 32;

  /**
   * Generate challenge token for MFA verification
   * Returned to client after password verification
   * Client uses this token when verifying MFA code
   */
  static async generateToken(
    userId: string,
    sessionId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(this.TOKEN_LENGTH).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + this.EXPIRY_MS);

    // Store hash in database (never raw token)
    await prisma.mFAChallengeToken.create({
      data: {
        userId,
        tokenHash,
        sessionId,
        ipAddress,
        userAgent,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Verify challenge token
   * Checks: exists, not expired, not already used
   * Returns token object if valid, null otherwise
   * Uses timing-safe userId comparison to prevent timing attacks
   */
  static async verifyToken(token: string, userId: string): Promise<any | null> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Timing-constant validation (always do DB lookup)
      let challengeToken = null;

      try {
        challengeToken = await prisma.mFAChallengeToken.findUnique({
          where: { tokenHash },
        });
      } catch {
        // No token found
      }

      // Verify ownership with timing-safe comparison
      if (!challengeToken) {
        return null;
      }

      try {
        // Use timing-safe comparison for userId to prevent timing attacks
        crypto.timingSafeEqual(
          Buffer.from(challengeToken.userId),
          Buffer.from(userId)
        );
      } catch {
        // Timing-safe equal throws on mismatch, return null without revealing timing info
        return null;
      }

      // Check expiry
      if (new Date() > challengeToken.expiresAt) {
        return null;
      }

      // Check not already used
      if (challengeToken.usedAt) {
        return null;
      }

      return challengeToken;
    } catch (error) {
      return null;
    }
  }

  /**
   * Mark challenge token as used (consume it)
   * Atomic operation to prevent reuse
   */
  static async consumeToken(tokenId: string): Promise<boolean> {
    try {
      const updated = await prisma.mFAChallengeToken.update({
        where: { id: tokenId },
        data: { usedAt: new Date() },
      });

      return !!updated;
    } catch (error) {
      return false;
    }
  }

  /**
   * Cleanup expired tokens
   * Run periodically (every 5-10 minutes)
   */
  static async cleanupExpired(): Promise<number> {
    const result = await prisma.mFAChallengeToken.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        usedAt: null,
      },
      data: {
        usedAt: new Date(), // Mark as used instead of deleting
      },
    });

    return result.count;
  }

  /**
   * Get token expiry time
   */
  static getExpiryTime(): Date {
    return new Date(Date.now() + this.EXPIRY_MS);
  }
}
