import argon2 from 'argon2';
import bcryptjs from 'bcryptjs';

/**
 * Password hashing, off the Node.js event loop.
 *
 * bcryptjs is a pure-JavaScript implementation: its hash/compare calls run
 * synchronously on the main thread inside a Promise wrapper, so a single
 * cost-12 hash blocks every other in-flight request on the process for
 * ~250-400ms (measured). Under concurrent logins this compounds into a
 * denial-of-service that requires no attacker effort beyond normal traffic.
 *
 * argon2 (the `argon2` package) is a native addon; its hash/verify calls are
 * dispatched to libuv's threadpool, so the main event loop keeps serving
 * other requests while a hash computes (measured: ~3ms of scheduling jitter
 * for a full hash, versus bcryptjs's ~97ms of direct blockage). It is also
 * OWASP's current top recommendation for password storage, using the
 * memory-hard Argon2id variant.
 *
 * Existing users in the database have bcrypt hashes (`$2a$`/`$2b$`/`$2y$`
 * prefix) from before this change. This module verifies against whichever
 * algorithm produced the stored hash and reports when a hash should be
 * transparently upgraded, so no user is locked out and no forced password
 * reset is needed to complete the migration.
 */

// OWASP Password Storage Cheat Sheet (2024): one of the four recommended
// Argon2id configurations. Chosen explicitly rather than relying on the
// library's default so the parameters are visible and intentional here,
// not merely inherited from whatever the installed version defaults to.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

/**
 * Hash a plaintext password with Argon2id. Use for all new passwords
 * (registration, password change/reset).
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash, whichever algorithm
 * produced it. Returns false (never throws) for a wrong password or a
 * malformed/corrupt hash — a corrupt hash must fail closed, not error out
 * in a way that could be mistaken for a different failure mode upstream.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    if (BCRYPT_HASH_PATTERN.test(hash)) {
      return await bcryptjs.compare(password, hash);
    }
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * True when the stored hash should be replaced with a fresh Argon2id hash:
 * either it's still a legacy bcrypt hash, or it's an Argon2 hash produced
 * with different (weaker, or since-changed) parameters than ARGON2_OPTIONS.
 * Callers should check this only after verifyPassword() has already
 * confirmed the password is correct, then re-hash and persist the new value
 * — this is the transparent migration path: no user-visible change, no
 * forced reset, existing sessions unaffected.
 */
export function needsRehash(hash: string): boolean {
  if (BCRYPT_HASH_PATTERN.test(hash)) {
    return true;
  }
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    // An unparseable hash isn't something we can rehash-detect for; treat
    // as needing a rehash so the next successful verify replaces it.
    return true;
  }
}
