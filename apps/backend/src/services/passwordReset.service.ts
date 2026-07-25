import { randomBytes } from 'node:crypto';
import { prisma } from '@synora/database';
import { getConfig } from '../config';
import { hashToken } from '../utils/hashToken';
import { durationToMs } from './token.service';

/**
 * Password-reset token lifecycle. Same hash-at-rest discipline as
 * RefreshToken: the raw token exists only in the email link, never
 * persisted. Single-use (`usedAt`) and short-lived (`expiresAt`).
 */

/**
 * Issues a fresh reset token for a user, invalidating any still-outstanding
 * ones first — only one reset link should ever be honorable at a time, so
 * an older, possibly-forwarded link can't be used after a newer one was
 * requested. Returns the raw token; the caller is responsible for emailing
 * it (never logging or persisting it anywhere but the hash).
 */
export async function issuePasswordResetToken(userId: string): Promise<string> {
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + durationToMs(getConfig().auth.passwordResetTokenExpiry));

  await prisma.passwordResetToken.create({
    data: { tokenHash: hashToken(rawToken), userId, expiresAt },
  });

  return rawToken;
}

/**
 * Validates and consumes a reset token: returns the owning userId if the
 * token exists, is unused, and unexpired — marking it used in the same
 * step so it can never be replayed. Returns null for anything else
 * (unknown/used/expired), which the caller must treat as a generic
 * failure — never revealing which condition failed.
 */
export async function consumePasswordResetToken(rawToken: string): Promise<{ userId: string } | null> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await prisma.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return { userId: record.userId };
}
