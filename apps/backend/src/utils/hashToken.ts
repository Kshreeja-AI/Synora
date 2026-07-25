import { createHash } from 'node:crypto';

/**
 * SHA-256 hash for at-rest storage of opaque bearer tokens (refresh tokens,
 * password-reset tokens, email-verification tokens). The raw value is never
 * persisted — only this hash — so a database read alone can never mint a
 * session or satisfy a reset/verification flow.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
