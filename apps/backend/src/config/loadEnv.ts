import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Environment loading, anchored to the APPLICATION rather than to wherever
 * the process happened to be launched from.
 *
 * WHAT THIS REPLACES, and why it mattered. The entrypoint used to do
 * `import 'dotenv/config'`, which loads exactly one file — `.env` — from
 * `process.cwd()`. Two problems, both silent:
 *
 *  1. This repository ships `.env.local`, not `.env`. That is what
 *     `.env.example` implies, what the setup docs tell a founder to create,
 *     and what `.gitignore` protects. `dotenv/config` never read it. Every
 *     value in it was ignored, and the application fell back to defaults
 *     without saying so.
 *  2. `process.cwd()` is not the app directory. Running from the repo root,
 *     from a monorepo task runner, or from a container with a different
 *     WORKDIR would each look somewhere different for the same file — so
 *     "it works on my machine" was literally a function of which directory
 *     the terminal was in.
 *
 * Both are the failure the launch directive names explicitly: a production
 * secret must never depend on an accidentally-ignored file being found by
 * an incorrect working directory.
 *
 * PRECEDENCE, highest first. `dotenv` never overwrites an already-set
 * variable, so loading in this order means the earlier file wins:
 *
 *   1. real process environment   — what a container/orchestrator injected
 *   2. .env.<stage>.local         — machine-specific override for a stage
 *   3. .env.local                 — the developer's own machine (NOT in test)
 *   4. .env.<stage>               — committed per-stage defaults, if any
 *   5. .env                       — committed shared defaults, if any
 *
 * The real environment outranking every file is the important one: in
 * production, secrets arrive as environment variables, and a stray file on
 * the image must never be able to shadow them.
 *
 * `.env.local` is SKIPPED under NODE_ENV=test so a developer's local
 * credentials cannot silently change what the test suite is testing.
 */

function appRoot(): string {
  // dist/ (bundled) or src/config/ (tsx) → walk up to the backend app dir.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '..', '..'), resolve(here, '..'), here];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
  }
  return process.cwd();
}

let loaded = false;

/**
 * Idempotent: safe to call from every entrypoint, which is why both the
 * server and the app module call it rather than relying on import order.
 */
export function loadEnv(): { root: string; files: string[] } {
  const root = appRoot();
  if (loaded) return { root, files: [] };
  loaded = true;

  const stage = process.env.NODE_ENV ?? 'development';
  const names = [
    `.env.${stage}.local`,
    ...(stage === 'test' ? [] : ['.env.local']),
    `.env.${stage}`,
    '.env',
  ];

  const files: string[] = [];
  for (const name of names) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    // `override: false` is the default and is load-bearing here — see the
    // precedence note above.
    dotenv.config({ path });
    files.push(name);
  }
  return { root, files };
}
