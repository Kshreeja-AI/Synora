import { randomBytes } from 'node:crypto';
import { prisma } from '@synora/database';
import { getConfig } from '../config';
import { hashToken } from '../utils/hashToken';
import { durationToMs } from './token.service';

/**
 * Email-verification token lifecycle. Same hash-at-rest discipline as
 * PasswordResetToken: the raw token exists only in the email link, never
 * persisted. Single-use (`usedAt`) and short-lived (`expiresAt`).
 */

/**
 * Issues a fresh verification token for a user, invalidating any still-
 * outstanding ones first (mirrors password-reset: only the most recently
 * requested link should work). Returns the raw token.
 */
export async function issueEmailVerificationToken(userId: string): Promise<string> {
  await prisma.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + durationToMs(getConfig().auth.emailVerificationTokenExpiry)
  );

  await prisma.emailVerificationToken.create({
    data: { tokenHash: hashToken(rawToken), userId, expiresAt },
  });

  return rawToken;
}

/**
 * Validates and consumes a verification token, marking the owning user's
 * email verified in the same transaction the token is consumed in.
 * Returns the userId on success, or null for anything else (unknown/used/
 * expired) — the caller must treat every failure identically.
 */
export async function consumeEmailVerificationToken(
  rawToken: string
): Promise<{ userId: string } | null> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
  ]);

  return { userId: record.userId };
}
