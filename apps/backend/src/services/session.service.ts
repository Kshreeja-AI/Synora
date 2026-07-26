import { prisma } from '@synora/database';
import { revokeAllUserTokens, revokeAllUserTokensExcept } from './token.service';

/**
 * The user-facing view of a "session" (device/browser signed in via a live
 * refresh token) — everything the account-security UI needs to let someone
 * recognize their own devices and revoke ones they don't. Deliberately not
 * the raw RefreshToken row: `deviceLabel` is derived, and `isCurrent` only
 * makes sense relative to the request asking for the list.
 */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  deviceLabel: string;
  rememberMe: boolean;
  isCurrent: boolean;
}

/**
 * Minimal, dependency-free user-agent parsing — good enough to render
 * "Chrome on macOS" in a session list, not a general-purpose UA database.
 * Order matters: e.g. Edge and Opera both include "Chrome" in their UA
 * string, so their checks must run first.
 */
export function parseUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';

  let browser = 'Unknown browser';
  if (/edg\//i.test(userAgent)) browser = 'Edge';
  else if (/opr\/|opera/i.test(userAgent)) browser = 'Opera';
  else if (/chrome|crios/i.test(userAgent)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(userAgent)) browser = 'Firefox';
  else if (/safari/i.test(userAgent)) browser = 'Safari';

  // iPhone/iPad user agents include "like Mac OS X", so iOS must be checked
  // before the broader macOS pattern.
  let os = 'Unknown OS';
  if (/windows/i.test(userAgent)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(userAgent)) os = 'macOS';
  else if (/android/i.test(userAgent)) os = 'Android';
  else if (/linux/i.test(userAgent)) os = 'Linux';

  return `${browser} on ${os}`;
}

/** Active (unrevoked, unexpired) sessions for a user, most recently used first. */
export async function listSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionSummary[]> {
  const records = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
  });

  return records.map((record) => ({
    id: record.id,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    ipAddress: record.ipAddress,
    deviceLabel: parseUserAgent(record.userAgent),
    rememberMe: record.rememberMe,
    isCurrent: record.id === currentSessionId,
  }));
}

/**
 * Revokes one session, scoped to its owner — a user can never revoke
 * someone else's session by guessing an id. Returns false if the session
 * doesn't exist, isn't the caller's, or is already inactive.
 */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const result = await prisma.refreshToken.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** "Log out everywhere" — revokes every active session, including the caller's own. */
export async function revokeAllSessions(userId: string): Promise<number> {
  return revokeAllUserTokens(userId);
}

/** Revokes every active session except one (e.g. the one making the request). */
export async function revokeOtherSessions(userId: string, exceptSessionId: string): Promise<number> {
  return revokeAllUserTokensExcept(userId, exceptSessionId);
}
