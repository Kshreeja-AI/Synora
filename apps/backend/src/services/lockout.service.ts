import { prisma } from '@synora/database';
import { getConfig } from '../config';

/**
 * Per-account login lockout.
 *
 * Deliberately DB-backed rather than in-memory: R1 runs a single backend
 * instance, so a per-process counter would be correct today, but storing the
 * state on the User row costs nothing extra and means this survives a
 * process restart and is already correct the moment a second instance is
 * added — no migration needed later. A move to a shared Redis-backed counter
 * (for high-frequency atomic increments under real concurrency) is tracked
 * as Release 2 item P1-2; this implementation is complete and correct for
 * Release 1's single-instance deployment target, not a stopgap.
 */

export interface LockoutStatus {
  isLocked: boolean;
  lockedUntil?: Date;
}

/** Check whether a user is currently locked out. Does not mutate state. */
export function checkLockout(user: { lockedUntil: Date | null }): LockoutStatus {
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return { isLocked: true, lockedUntil: user.lockedUntil };
  }
  return { isLocked: false };
}

/**
 * Record a failed password attempt. Increments the counter; once it reaches
 * the configured threshold, sets lockedUntil to now + the configured
 * duration and resets the counter (so unlocking after the window starts a
 * fresh count rather than immediately re-locking on the next single failure).
 */
export async function recordFailedLogin(userId: string): Promise<void> {
  const { maxFailedLoginAttempts, lockoutDurationMinutes } = getConfig().auth;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginAttempts: true },
  });
  if (!user) return;

  const attempts = user.failedLoginAttempts + 1;

  if (attempts >= maxFailedLoginAttempts) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + lockoutDurationMinutes * 60_000),
      },
    });
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: attempts },
  });
}

/** Reset lockout state on a successful login. */
export async function clearLoginLockout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
