import { ForbiddenException } from '@synora/shared';
import { prisma } from '@synora/database';

/**
 * Who may create an account.
 *
 * REGISTRATION_MODE=invite (the default) is a closed beta: /auth/register
 * succeeds only for an email that is on REGISTRATION_ALLOWLIST (comma
 * separated; this is how the very first account is created, since inviting
 * someone needs an account) or that holds a live workspace invitation
 * (not accepted, not revoked, not expired).
 *
 * REGISTRATION_MODE=open lets anyone register. Only the founder switches it.
 *
 * Any other value -- including a typo -- is treated as "invite". A policy
 * flag that fails open on a mistyped value would silently open public signup.
 */

export type RegistrationMode = 'invite' | 'open';

export function registrationMode(env: NodeJS.ProcessEnv = process.env): RegistrationMode {
  return env.REGISTRATION_MODE?.trim().toLowerCase() === 'open' ? 'open' : 'invite';
}

function allowlist(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (env.REGISTRATION_ALLOWLIST ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function assertRegistrationAllowed(
  email: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (registrationMode(env) === 'open') return;

  const normalized = email.trim().toLowerCase();
  if (allowlist(env).has(normalized)) return;

  const invitation = await prisma.workspaceInvitation.findFirst({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (invitation) return;

  // One message for every refusal: it must not reveal whether an address is
  // known, invited, or already registered.
  throw new ForbiddenException('Registration is by invitation only.');
}
