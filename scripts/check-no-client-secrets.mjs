#!/usr/bin/env node
/**
 * Guards "secrets must never be exposed to frontend": fails the build if
 * any client-bundled file references a non-NEXT_PUBLIC_ environment
 * variable, or if next.config.js's `env` block maps one in.
 *
 * This is a static, best-effort check (regex over source text), not a
 * full bundler analysis — it catches the common mistake (a secret read
 * directly in a 'use client' component) but is not a substitute for
 * keeping secret access inside apps/backend/src/secrets.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const webSrc = path.join(repoRoot, 'apps/web/src');
const nextConfigPath = path.join(repoRoot, 'apps/web/next.config.js');

const ENV_REF = /process\.env\.([A-Z0-9_]+)/g;

/** @type {{ file: string; key: string }[]} */
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      checkFile(full);
    }
  }
}

function checkFile(file) {
  const content = readFileSync(file, 'utf-8');
  const isClientFile = /^\s*['"]use client['"]/.test(content);
  if (!isClientFile) return;

  for (const match of content.matchAll(ENV_REF)) {
    const key = match[1];
    if (!key.startsWith('NEXT_PUBLIC_')) {
      violations.push({ file: path.relative(repoRoot, file), key });
    }
  }
}

function checkNextConfig() {
  let content;
  try {
    content = readFileSync(nextConfigPath, 'utf-8');
  } catch {
    return;
  }

  const envBlockMatch = content.match(/env:\s*{([^}]*)}/s);
  if (!envBlockMatch) return;

  const keyPattern = /^\s*([A-Z0-9_]+)\s*:/gm;
  for (const match of envBlockMatch[1].matchAll(keyPattern)) {
    const key = match[1];
    if (!key.startsWith('NEXT_PUBLIC_')) {
      violations.push({ file: path.relative(repoRoot, nextConfigPath), key });
    }
  }
}

try {
  walk(webSrc);
} catch {
  // apps/web/src doesn't exist yet in this checkout — nothing to check.
}
checkNextConfig();

if (violations.length > 0) {
  console.error('Secret exposure check failed — non-public env vars referenced from client code:\n');
  for (const v of violations) {
    console.error(`  ${v.file}: process.env.${v.key}`);
  }
  console.error(
    '\nOnly NEXT_PUBLIC_*-prefixed env vars may be read from client (\'use client\') files ' +
      'or from next.config.js\'s `env` block. Move this access into a Server Component, an API ' +
      'route, or apps/backend, and pass only the derived non-secret value down as a prop.'
  );
  process.exit(1);
}

console.log('Secret exposure check passed: no non-public env vars referenced from client code.');
