import crypto from 'crypto';

import { prisma } from '@synora/database';
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
    userAgent: string,
    rememberMe = false
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(this.TOKEN_LENGTH).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + this.EXPIRY_MS);

    // Store hash in database (never raw token).
    //
    // rememberMe rides along with the challenge because the choice is made on
    // the password screen but only acted on once the second factor clears —
    // without persisting it here, every MFA user would silently fall back to a
    // short session regardless of what they ticked.
    await prisma.mFAChallengeToken.create({
      data: {
        userId,
        tokenHash,
        sessionId,
        ipAddress,
        userAgent,
        expiresAt,
        rememberMe,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Verify a challenge token, returning the token row when it is valid and
   * null otherwise (unknown, expired, already consumed, or — when
   * `expectedUserId` is supplied — owned by a different user).
   *
   * The raw token is 32 bytes of CSPRNG output and is only ever stored as a
   * SHA-256 hash, so possession of the token is itself the proof of identity:
   * the login flow legitimately calls this without an `expectedUserId`, since
   * the whole point is to learn which user is completing the challenge. Pass
   * `expectedUserId` whenever the caller already knows who the token must
   * belong to, so a token issued for one account can never be redeemed
   * against another.
   */
  static async verifyToken(token: string, expectedUserId?: string): Promise<any | null> {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const challengeToken = await prisma.mFAChallengeToken.findUnique({
        where: { tokenHash },
      });

      if (!challengeToken) {
        return null;
      }

      // Ownership check. crypto.timingSafeEqual throws when the two buffers
      // differ in length and otherwise RETURNS a boolean — the return value is
      // the answer and must be honoured. Ignoring it (and relying only on the
      // throw) accepts every equal-length mismatch, which for fixed-length
      // cuid user ids means any token would validate against any account.
      if (expectedUserId !== undefined) {
        const actual = Buffer.from(challengeToken.userId);
        const expected = Buffer.from(expectedUserId);
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
          return null;
        }
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
    } catch {
      return null;
    }
  }

  /**
   * Claim a challenge token, returning true only for the caller that actually
   * consumed it.
   *
   * The `usedAt: null` guard makes this a single conditional UPDATE, so when
   * two requests race with the same token exactly one matches an unused row
   * and the loser gets count 0. An unconditional update would let both
   * requests "succeed" and mint two sessions from one challenge.
   */
  static async consumeToken(tokenId: string): Promise<boolean> {
    try {
      const result = await prisma.mFAChallengeToken.updateMany({
        where: { id: tokenId, usedAt: null },
        data: { usedAt: new Date() },
      });

      return result.count === 1;
    } catch {
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
