import { describe, it, expect } from 'vitest';
import bcryptjs from 'bcryptjs';
import { hashPassword, verifyPassword, needsRehash } from '../password.service';

describe('password.service', () => {
  describe('hashPassword()', () => {
    it('produces an Argon2id hash', async () => {
      const hash = await hashPassword('correct horse battery staple');

      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('produces a different hash each time (random salt)', async () => {
      const hash1 = await hashPassword('same password');
      const hash2 = await hashPassword('same password');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword()', () => {
    it('verifies a correct password against an Argon2 hash', async () => {
      const hash = await hashPassword('my-secret-password');

      expect(await verifyPassword(hash, 'my-secret-password')).toBe(true);
    });

    it('rejects an incorrect password against an Argon2 hash', async () => {
      const hash = await hashPassword('my-secret-password');

      expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
    });

    it('verifies a correct password against a legacy bcrypt hash', async () => {
      const legacyHash = await bcryptjs.hash('legacy-password', 12);

      expect(await verifyPassword(legacyHash, 'legacy-password')).toBe(true);
    });

    it('rejects an incorrect password against a legacy bcrypt hash', async () => {
      const legacyHash = await bcryptjs.hash('legacy-password', 12);

      expect(await verifyPassword(legacyHash, 'wrong-password')).toBe(false);
    });

    it('recognizes all three bcrypt prefix variants as legacy hashes', async () => {
      // bcryptjs itself only ever produces $2a$/$2b$, but hashes from other
      // bcrypt implementations (PHP password_hash, etc.) may be $2y$ — the
      // detection must route all of them to bcrypt verification, not Argon2.
      const variants = ['$2a$', '$2b$', '$2y$'];
      const realHash = await bcryptjs.hash('prefix-test', 12);

      for (const prefix of variants) {
        const swapped = prefix + realHash.slice(4);
        // bcryptjs.compare accepts any of the three prefixes identically,
        // so this confirms verifyPassword's routing, not bcrypt's parsing.
        expect(await verifyPassword(swapped, 'prefix-test')).toBe(true);
      }
    });

    it('returns false (never throws) for a malformed hash', async () => {
      await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false);
    });

    it('returns false (never throws) for an empty hash', async () => {
      await expect(verifyPassword('', 'anything')).resolves.toBe(false);
    });
  });

  describe('needsRehash()', () => {
    it('is true for a legacy bcrypt hash', async () => {
      const legacyHash = await bcryptjs.hash('some-password', 12);

      expect(needsRehash(legacyHash)).toBe(true);
    });

    it('is false for a hash freshly produced by hashPassword()', async () => {
      const hash = await hashPassword('some-password');

      expect(needsRehash(hash)).toBe(false);
    });

    it('is true for an Argon2 hash produced with weaker parameters', async () => {
      const argon2 = await import('argon2');
      const weakHash = await argon2.hash('some-password', {
        type: argon2.argon2id,
        memoryCost: 1024,
        timeCost: 1,
        parallelism: 1,
      });

      expect(needsRehash(weakHash)).toBe(true);
    });

    it('is true for an unparseable hash (fail toward re-hashing, not toward silent staleness)', () => {
      expect(needsRehash('garbage')).toBe(true);
    });
  });

  describe('end-to-end migration scenario', () => {
    it('a legacy bcrypt hash verifies correctly and is flagged for rehash, and the rehash then verifies and is not flagged again', async () => {
      const password = 'user-original-password';
      const legacyHash = await bcryptjs.hash(password, 12);

      // Step 1: user logs in on their old bcrypt hash.
      expect(await verifyPassword(legacyHash, password)).toBe(true);
      expect(needsRehash(legacyHash)).toBe(true);

      // Step 2: the auth route would now re-hash and persist.
      const migratedHash = await hashPassword(password);

      // Step 3: the user's next login uses the new hash — still correct,
      // and no longer flagged for migration.
      expect(await verifyPassword(migratedHash, password)).toBe(true);
      expect(needsRehash(migratedHash)).toBe(false);
      expect(migratedHash.startsWith('$argon2id$')).toBe(true);
    });
  });
});
