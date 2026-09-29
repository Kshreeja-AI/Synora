/**
 * A PLACEHOLDER PUBLISHED IN GIT MUST NOT BOOT PRODUCTION.
 *
 * `KNOWN_DEV_SECRET_VALUES` exists so a copied `.env.example` cannot start
 * staging or production: a value anyone can read out of this repository is
 * not a secret, however long it is. Its own comment explains the case it
 * was written for — `.env.example`'s 40-character `JWT_SECRET`, long
 * enough to sail past the minimum-length floor.
 *
 * It then fell behind the very files it guards. Three placeholders were
 * unblocked for as long as they had existed:
 *
 *   .env.example            NEXTAUTH_SECRET  (41 chars)
 *   apps/web/.env.example   NEXTAUTH_SECRET  (36 chars)
 *   both                    DATABASE_URL     (localhost, password in git)
 *
 * Both NEXTAUTH_SECRET values clear the 32-character floor, so nothing
 * else would have stopped them — and that key encrypts sessions. A
 * production boot on it means anyone who can read this repository can
 * forge a session.
 *
 * THE POINT OF THIS FILE. Adding the three missing values fixes today.
 * A hand-maintained list drifting from the files it guards is the failure
 * mode, and it will simply happen again. So the check is DERIVED: every
 * uncommented secret assignment is read out of the template files
 * themselves, and each one must be blocked. Adding a placeholder to a
 * template without blocking it now fails here, at the moment it is added,
 * rather than at a production boot nobody is watching.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_CATALOG, KNOWN_DEV_SECRET_VALUES } from '../registry';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** Every `.env.example` committed to the repository. */
const TEMPLATES = ['.env.example', 'apps/backend/.env.example', 'apps/web/.env.example'];

const SECRET_KEYS = new Set(SECRET_CATALOG.map((s) => s.key));

interface Assignment {
  file: string;
  line: number;
  name: string;
  value: string;
}

/**
 * Uncommented `NAME=value` assignments of catalogued secrets.
 *
 * Commented lines (`# NEXTAUTH_SECRET=`) and empty assignments are exactly
 * what a template SHOULD contain and are not collected — there is no value
 * to leak.
 */
function secretAssignments(): Assignment[] {
  const found: Assignment[] = [];
  for (const file of TEMPLATES) {
    const lines = readFileSync(resolve(REPO_ROOT, file), 'utf8').split('\n');
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line.startsWith('#') || !line.includes('=')) return;
      const [name, ...rest] = line.split('=');
      const value = rest.join('=');
      if (SECRET_KEYS.has(name) && value !== '') {
        found.push({ file, line: index + 1, name, value });
      }
    });
  }
  return found;
}

describe('secret placeholders shipped in templates', () => {
  it('finds the assignments at all — a silent zero would prove nothing', () => {
    // Guards the guard. If the parser broke, or the template paths moved,
    // every assertion below would pass vacuously against an empty list and
    // report a clean bill of health for a check that ran on nothing.
    expect(secretAssignments().length).toBeGreaterThan(0);
  });

  it('blocks EVERY placeholder a template ships, not just the remembered ones', () => {
    // THE DRIFT THIS PINS. The list was written for JWT_SECRET and never
    // extended when the other templates gained their own placeholders.
    const unblocked = secretAssignments().filter(
      (a) => !KNOWN_DEV_SECRET_VALUES.has(a.value)
    );

    expect(
      unblocked,
      unblocked.length === 0
        ? ''
        : 'These template values would boot staging/production even though they ' +
          'are published in git. Add each to KNOWN_DEV_SECRET_VALUES in ' +
          `secrets/registry.ts, or comment the line out:\n${unblocked
            .map((a) => `  ${a.file}:${a.line}  ${a.name}`)
            .join('\n')}`
    ).toEqual([]);
  });

  it('keeps every blocked value long enough to reach the check', () => {
    // A placeholder SHORTER than its minimum is already refused by the
    // length floor, so blocking it proves nothing. The dangerous ones are
    // precisely those long enough to look real — and this asserts the
    // blocklist is earning its place rather than duplicating a check that
    // already exists.
    const minimums = new Map(
      SECRET_CATALOG.filter((s) => s.minLength).map((s) => [s.key, s.minLength as number])
    );
    for (const assignment of secretAssignments()) {
      const minimum = minimums.get(assignment.name);
      if (minimum === undefined) continue;
      expect(
        assignment.value.length,
        `${assignment.file}:${assignment.line} ${assignment.name} is below its own minimum — ` +
          'the length floor already refuses it, so it does not need blocking'
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('has no unused entries left behind by a template that changed', () => {
    // The other direction. A blocked value no template ships any more is
    // dead weight that makes the list look more thorough than it is —
    // exactly the impression that let the real gaps sit unnoticed.
    // Test-only values are exempt: they live in test setup, not templates.
    const TEST_ONLY = new Set([
      'test-jwt-secret-key-for-testing-only',
      'test-only-not-a-real-secret-tool-master-key-000000',
      'sk_test_fake_key_for_testing',
    ]);
    const shipped = new Set(secretAssignments().map((a) => a.value));
    const orphans = [...KNOWN_DEV_SECRET_VALUES].filter(
      (v) => !shipped.has(v) && !TEST_ONLY.has(v)
    );
    expect(orphans, `blocked but no longer in any template: ${orphans.join(', ')}`).toEqual([]);
  });
});
