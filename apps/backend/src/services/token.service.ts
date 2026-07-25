import { randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { prisma } from '@synora/database';
import { secretsManager } from '../secrets';
import { getConfig } from '../config';
import { hashToken } from '../utils/hashToken';

/**
 * Access + refresh token issuance, rotation, and revocation.
 *
 * Access token: a short-lived stateless JWT (HS256), carrying the user's id,
 * email, role, and `sid` — the id of the RefreshToken row this access token
 * was minted alongside. `sid` is what lets a signed-in user's client ask
 * "which of my sessions is this one?" (see `session.service.ts`) without any
 * extra round trip.
 *
 * Refresh token: a long, opaque, cryptographically-random string. Only its
 * SHA-256 hash is stored, so a database compromise cannot mint sessions. On
 * refresh the presented token is rotated (revoked and replaced), which both
 * limits the window of a leaked token and provides reuse detection surface.
 * Logout revokes the refresh token — that is what makes "log out" actually
 * end the session: the access token expires within minutes and no new one can
 * be issued without a live, unrevoked refresh token.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** The RefreshToken row id backing this pair — the session identifier. */
  sessionId: string;
}

export interface AccessTokenClaims {
  userId: string;
  email: string;
  role: string;
}

export interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
  /** Persisted only for display in the session list; never affects verification. */
  rememberMe?: boolean;
}

/**
 * Parse a duration string like "7d", "15m", "24h", "3600s", or a bare number
 * of seconds, into milliseconds. Used to compute the refresh token's DB
 * expiry from the same config value that drives the JWT's expiry, so the two
 * never drift.
 */
export function durationToMs(duration: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Unparseable duration: "${duration}"`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const unitMs: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * unitMs[unit];
}

async function signAccessToken(claims: AccessTokenClaims & { sid: string }): Promise<string> {
  const jwtSecret = await secretsManager.get('JWT_SECRET', 'backend:token-service');
  return jwt.sign(
    { userId: claims.userId, email: claims.email, role: claims.role, sid: claims.sid },
    jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: getConfig().auth.jwtExpiry as SignOptions['expiresIn'],
    }
  );
}

function refreshExpiryFor(rememberMe: boolean | undefined): Date {
  const { jwtRefreshExpiry, jwtRefreshExpiryRememberMe } = getConfig().auth;
  const duration = rememberMe ? jwtRefreshExpiryRememberMe : jwtRefreshExpiry;
  return new Date(Date.now() + durationToMs(duration));
}

/**
 * Issue a fresh access + refresh token pair for a user and persist the
 * refresh token (hashed), along with device metadata for the session list.
 * Called on register and login.
 */
export async function issueTokens(
  claims: AccessTokenClaims,
  metadata: SessionMetadata = {}
): Promise<AuthTokens> {
  const rawRefreshToken = randomBytes(48).toString('base64url');

  const record = await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(rawRefreshToken),
      userId: claims.userId,
      expiresAt: refreshExpiryFor(metadata.rememberMe),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      rememberMe: metadata.rememberMe ?? false,
    },
  });

  const accessToken = await signAccessToken({ ...claims, sid: record.id });

  return { accessToken, refreshToken: rawRefreshToken, sessionId: record.id };
}

/**
 * Exchange a valid, unrevoked, unexpired refresh token for a new token pair,
 * rotating the refresh token (the presented one is revoked). Returns null if
 * the token is unknown, already revoked, or expired — the caller must treat
 * null as "re-authenticate", never as success. The new row carries forward
 * `rememberMe` from the token being rotated (that policy is fixed at login),
 * but refreshes `userAgent`/`ipAddress` to the current request when given —
 * a session's displayed device/location should reflect where it was last
 * actually used.
 */
export async function rotateTokens(
  rawRefreshToken: string,
  metadata: Pick<SessionMetadata, 'userAgent' | 'ipAddress'> = {}
): Promise<AuthTokens | null> {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawRefreshToken) },
    include: {
      user: { select: { id: true, email: true, role: true, status: true } },
    },
  });

  if (!record || record.revokedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  // A deactivated/suspended account must not be able to refresh a session.
  if (record.user.status !== 'ACTIVE') {
    return null;
  }

  // Rotate: revoke the presented token and issue a fresh pair atomically.
  const rawNewRefreshToken = randomBytes(48).toString('base64url');
  const newRecord = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return tx.refreshToken.create({
      data: {
        tokenHash: hashToken(rawNewRefreshToken),
        userId: record.userId,
        expiresAt: refreshExpiryFor(record.rememberMe),
        rememberMe: record.rememberMe,
        userAgent: metadata.userAgent ?? record.userAgent,
        ipAddress: metadata.ipAddress ?? record.ipAddress,
      },
    });
  });

  const accessToken = await signAccessToken({
    userId: newRecord.userId,
    email: record.user.email,
    role: record.user.role,
    sid: newRecord.id,
  });

  return { accessToken, refreshToken: rawNewRefreshToken, sessionId: newRecord.id };
}

/**
 * Revoke a single refresh token (logout). Idempotent: revoking an unknown or
 * already-revoked token is a no-op and reports false, so a double logout or a
 * logout with a stale token never errors.
 */
export async function revokeRefreshToken(rawRefreshToken: string): Promise<boolean> {
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawRefreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Revoke every active refresh token for a user (e.g. "log out everywhere",
 * or forced invalidation on password change/reset/account deletion).
 * Returns the number revoked.
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Revoke every active refresh token for a user except one session (e.g. a
 * password change should end every *other* session while keeping the one
 * that just made the change signed in). Returns the number revoked.
 */
export async function revokeAllUserTokensExcept(
  userId: string,
  exceptSessionId: string
): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, id: { not: exceptSessionId } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
