#!/usr/bin/env node
/**
 * Create `apps/backend/.env.local`, generating every secret Synora can
 * generate for itself.
 *
 * WHY THIS EXISTS. Setting Synora up used to mean running `openssl rand
 * -base64 32` three times and pasting the results into the right places.
 * Those are the three steps most likely to be skipped, mistyped, or — worst
 * — pasted into a chat window on the way. A machine does them perfectly and
 * silently, and a secret that is never handled by a person is never
 * mishandled by one.
 *
 * WHAT IT WILL NOT DO:
 *
 *   - It never overwrites a value that is already set. Re-running it is
 *     safe: it fills gaps and leaves everything else exactly as it was.
 *     A generator that clobbered a live JWT_SECRET would sign every user
 *     out and make every stored tool credential undecryptable, and it
 *     would do it to whoever ran the setup script twice.
 *   - It never prints a secret. Not to the terminal, not to a log. It
 *     reports the NAME and that a value now exists — the only two facts
 *     anyone needs.
 *   - It never invents a value it cannot honestly produce. A database URL
 *     describes a server that already exists and an API key is an account,
 *     not a random string; both are written as clearly-marked blanks with
 *     the consequence of leaving them empty, not as plausible fakes.
 *
 * Usage:  pnpm run setup:env
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(REPO_ROOT, 'apps/backend/.env.local');

/**
 * Mirrors `apps/backend/src/config/envCatalog.ts`.
 *
 * Duplicated rather than imported on purpose: this script runs during
 * setup, BEFORE `pnpm install` has necessarily happened and before
 * TypeScript has been compiled — importing from the app would make the
 * bootstrap depend on the thing it is bootstrapping. A test asserts the two
 * lists agree, so the duplication cannot drift.
 */
const GENERATED = [
  { name: 'JWT_SECRET', bytes: 32, note: 'Signs the tokens that keep someone logged in.' },
  { name: 'NEXTAUTH_SECRET', bytes: 32, note: 'Encrypts session cookies in the browser.' },
  {
    name: 'TOOL_SECRET_MASTER_KEY',
    bytes: 32,
    note: 'Encrypts the credentials people store for their own tools.',
  },
];

const SUPPLIED = [
  {
    name: 'DATABASE_URL',
    note: 'Where the database lives, including its password. Synora cannot start without it.',
    devDefault: 'postgresql://synora:synora@localhost:5432/synora',
  },
  {
    name: 'CORS_ORIGINS',
    note:
      'Which website addresses may talk to the API. In production, leaving this at localhost ' +
      'means the site loads and nothing works — the server refuses to start rather than let that happen.',
    devDefault: 'http://localhost:3000',
  },
  {
    name: 'FRONTEND_URL',
    note:
      'Public address of the website. Every email link is built from it, so a localhost value ' +
      "sends users to their own machine.",
    devDefault: 'http://localhost:3000',
  },
  {
    name: 'BACKEND_URL',
    note: 'Public address of the API. Uploaded-file links are built from it.',
    devDefault: 'http://localhost:3001',
  },
];

/** Values already present in the file, so nothing set is ever replaced. */
function readExisting(path) {
  if (!existsSync(path)) return { lines: [], names: new Set() };
  const lines = readFileSync(path, 'utf8').split('\n');
  const names = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#') || !line.includes('=')) continue;
    const [name, ...rest] = line.split('=');
    // A name with an EMPTY value counts as absent: the point of this script
    // is to fill blanks, and a bare `JWT_SECRET=` is a blank.
    if (rest.join('=').trim() !== '') names.add(name.trim());
  }
  return { lines, names };
}

function main() {
  const isProduction = process.argv.includes('--production');
  const { lines, names } = readExisting(TARGET);
  const additions = [];
  const generated = [];
  const needsYou = [];

  for (const spec of GENERATED) {
    if (names.has(spec.name)) continue;
    additions.push(`# ${spec.note}`, `${spec.name}=${randomBytes(spec.bytes).toString('base64')}`, '');
    generated.push(spec.name);
  }

  for (const spec of SUPPLIED) {
    if (names.has(spec.name)) continue;
    // In production the development default is not merely unhelpful, it is
    // the exact value the boot gate refuses — so it is left blank rather
    // than written in and quietly inherited.
    const value = isProduction ? '' : spec.devDefault;
    additions.push(`# ${spec.note}`, `${spec.name}=${value}`, '');
    if (value === '') needsYou.push(spec.name);
  }

  if (additions.length === 0) {
    console.log('Nothing to do — every value this script manages is already set.');
    return;
  }

  const header =
    lines.length === 0
      ? [
          '# Synora local configuration.',
          '#',
          '# Generated by `pnpm run setup:env`. Safe to re-run: it only fills in',
          '# blanks and never replaces a value that is already here.',
          '#',
          '# THIS FILE IS NOT IN GIT AND MUST NEVER BE. It holds real secrets.',
          '',
        ]
      : [];

  mkdirSync(dirname(TARGET), { recursive: true });
  const body = [...(lines.length ? [...lines, ''] : []), ...header, ...additions].join('\n');
  writeFileSync(TARGET, body, { mode: 0o600 });
  // Re-assert on an existing file, where the mode above does not apply.
  chmodSync(TARGET, 0o600);

  // NAMES ONLY. Never a value, not even truncated — a "safe" prefix of a
  // secret in a terminal scrollback is still part of a secret.
  console.log(`Wrote ${TARGET} (readable only by you).\n`);
  if (generated.length) {
    console.log('Generated for you — you never need to see or handle these:');
    for (const name of generated) console.log(`  ${name}`);
    console.log('');
  }
  if (needsYou.length) {
    console.log('Left blank because only you can supply them:');
    for (const name of needsYou) console.log(`  ${name}`);
    console.log('');
  }
  console.log('Nothing was printed that should stay private.');
}

main();
