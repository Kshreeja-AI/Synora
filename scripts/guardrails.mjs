#!/usr/bin/env node
/**
 * Synora guardrails — checks that can actually fail.
 *
 * Every check here exists because the corresponding mistake was made, or came
 * close to being made, in this repository. A check that cannot fail is worse
 * than no check: it produces green output and buys false confidence, which is
 * the specific failure `SYNORA_FOUNDER_OS.md` Part IV exists to prevent.
 *
 * Deliberately NOT included: "does a test file exist", "is there a README",
 * and similar presence checks. They are always green and therefore tell you
 * nothing.
 *
 * Exit 0 = all checks passed. Exit 1 = at least one FAIL.
 * Secrets are never printed — only names, counts, and locations.
 *
 *   node scripts/guardrails.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const results = [];
const record = (name, ok, detail, severity = 'FAIL') =>
  results.push({ name, ok, detail, severity });

/** git, resolved the same way the PowerShell scripts do. */
function git(args) {
  const candidates = [
    'git',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    '/usr/bin/git',
  ];
  for (const exe of candidates) {
    try {
      return execFileSync(exe, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      if (err.status !== undefined) return ''; // ran, non-zero exit
    }
  }
  throw new Error('git not found');
}

const tracked = git(['ls-files']).split(/\r?\n/).filter(Boolean);

// ---------------------------------------------------------------------------
// 1. No real environment file is tracked.
// ---------------------------------------------------------------------------
{
  const bad = tracked.filter(
    (f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.(example|sample|template)$/.test(f)
  );
  record('no tracked .env files', bad.length === 0, bad.length ? bad.join(', ') : 'none tracked');
}

// ---------------------------------------------------------------------------
// 2. No live credential shapes in tracked files.
//    Test fixtures for the redactor are excluded BY PATH, not by pattern —
//    excluding by pattern would blind the check to the real thing.
// ---------------------------------------------------------------------------
{
  const CRED = /(sbp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,})/;
  const ALLOW = /(redaction|templatePlaceholders|validateRequired)\.test\.ts$/;
  const hits = [];
  for (const f of tracked) {
    if (ALLOW.test(f)) continue;
    if (!/\.(ts|tsx|js|mjs|json|yml|yaml|md|sh|ps1|env\..*)$/.test(f)) continue;
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (CRED.test(line)) hits.push(`${f}:${i + 1}`); // location only, never the value
    });
  }
  record('no credential patterns in tracked files', hits.length === 0, hits.length ? hits.join(', ') : 'clean');
}

// ---------------------------------------------------------------------------
// 3. The real env file is ignored AND untracked.
//    Both, because ignore rules do not apply to a path git already tracks.
// ---------------------------------------------------------------------------
{
  const target = 'apps/backend/.env.local';
  const isTracked = tracked.includes(target);
  const ignoreOut = git(['check-ignore', '-q', '--', target]);
  const isIgnored = ignoreOut !== null && !isTracked
    ? (() => { try { execFileSync('git', ['check-ignore', '-q', '--', target], { cwd: REPO, stdio: 'ignore' }); return true; }
               catch { try { execFileSync('C:\\Program Files\\Git\\cmd\\git.exe', ['check-ignore', '-q', '--', target], { cwd: REPO, stdio: 'ignore' }); return true; } catch { return false; } } })()
    : false;
  record('.env.local ignored and untracked', isIgnored && !isTracked,
    `ignored=${isIgnored} tracked=${isTracked}`);
}

// ---------------------------------------------------------------------------
// 4. No placeholder left in a REQUIRED credential slot.
//    Local-only: absent env file is not a failure (CI has no .env.local).
// ---------------------------------------------------------------------------
{
  const p = join(REPO, 'apps/backend/.env.local');
  if (!existsSync(p)) {
    record('no placeholder credentials', true, 'no local env file (skipped)', 'INFO');
  } else {
    const REQUIRED = ['SELF_HOSTED_TEXT_API_KEY', 'SELF_HOSTED_TEXT_BASE_URL', 'SELF_HOSTED_TEXT_MODEL', 'JWT_SECRET', 'TOOL_SECRET_MASTER_KEY', 'DATABASE_URL'];
    const left = [];
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq < 1 || line.trimStart().startsWith('#')) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).replace(/\r$/, '');
      if (REQUIRED.includes(k) && (/^(PASTE_|CHANGE_ME|YOUR_|REPLACE_|<)/.test(v) || v === '')) {
        left.push(k); // name only
      }
    }
    record('no placeholder credentials', left.length === 0, left.length ? left.join(', ') : 'all required values set');
  }
}

// ---------------------------------------------------------------------------
// 5. Provider coupling. Business logic must not import a vendor SDK.
//    The provider layer is where vendor names are allowed to exist.
// ---------------------------------------------------------------------------
{
  const VENDOR = /from\s+['"](openai|@anthropic-ai\/[\w-]+|@google\/[\w-]+|@aws-sdk\/[\w-]+|replicate|cohere-ai|@mistralai\/[\w-]+|groq-sdk|together-ai)['"]/;
  const PROVIDER_LAYER = /^apps\/backend\/src\/(ai|embeddings|vectordb|storage|mail|billing|test-support)\//;
  const BUSINESS = /^apps\/backend\/src\/(routes|services|workers|middleware|eos)\//;
  // Bounded, documented exceptions. An entry here is a decision on the record,
  // not a way to make the check quiet: anything NOT listed still fails, and the
  // reason has to survive being read aloud.
  const EXCEPTIONS = new Map([
    ['apps/backend/src/eos/model-endpoint-probes.ts',
     'uses the `openai` package as a generic OpenAI-COMPATIBLE protocol client to ' +
     'GET /v1/models on self-hosted endpoints; it is not bound to OpenAI the vendor. ' +
     'Should eventually probe via the provider layer verifyCredential() instead.'],
  ]);

  const hits = [];
  const excused = [];
  for (const f of tracked) {
    if (!BUSINESS.test(f) || PROVIDER_LAYER.test(f) || /__tests__|\.test\.ts$/.test(f)) continue;
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (!VENDOR.test(text)) continue;
    if (EXCEPTIONS.has(f)) excused.push(f);
    else hits.push(f);
  }
  const note = excused.length
    ? `no unlisted vendor imports (${excused.length} documented exception${excused.length > 1 ? 's' : ''})`
    : 'no vendor imports outside the provider layer';
  record('business logic free of vendor SDK imports', hits.length === 0,
    hits.length ? hits.join(', ') : note);
  for (const f of excused) {
    record(`  ↳ exception: ${f.split('/').pop()}`, true, EXCEPTIONS.get(f).slice(0, 96) + '…', 'INFO');
  }
}

// ---------------------------------------------------------------------------
// 6. Production compose publishes ONLY 80/443.
//    A published database port is the difference between a private database
//    and one the internet can reach.
// ---------------------------------------------------------------------------
{
  const p = join(REPO, 'docker-compose.production.yml');
  if (!existsSync(p)) {
    record('only 80/443 published in production compose', false, 'compose file missing');
  } else {
    const published = [];
    let inPorts = false;
    for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.replace(/\r$/, '');
      if (/^\s*ports:\s*$/.test(line)) { inPorts = true; continue; }
      if (inPorts) {
        const m = line.match(/^\s*-\s*["']?(\d+):(\d+)["']?\s*$/);
        if (m) { published.push(m[1]); continue; }
        if (/^\s*-\s/.test(line) || /^\s*\S+:/.test(line)) inPorts = false;
      }
    }
    const disallowed = published.filter((p2) => p2 !== '80' && p2 !== '443');
    record('only 80/443 published in production compose', disallowed.length === 0,
      published.length ? `published=[${published.join(', ')}]` : 'no published ports found');
  }
}

// ---------------------------------------------------------------------------
// 7. No secret-shaped name behind NEXT_PUBLIC_ (anything so prefixed ships to
//    the browser, so the prefix is a promise the value is public).
// ---------------------------------------------------------------------------
{
  const hits = [];
  for (const f of tracked) {
    if (!/^apps\/web\//.test(f) || !/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/NEXT_PUBLIC_([A-Z0-9_]+)/g)) {
      if (/(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE)/.test(m[1]) && !/PUBLISHABLE|PUBLIC/.test(m[1])) {
        hits.push(`${f}: NEXT_PUBLIC_${m[1]}`);
      }
    }
  }
  record('no secret-shaped NEXT_PUBLIC_ variables', hits.length === 0,
    hits.length ? hits.join(', ') : 'none');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pad = Math.max(...results.map((r) => r.name.length));
let failed = 0;
console.log('\n  SYNORA GUARDRAILS\n');
for (const r of results) {
  const tag = r.ok ? 'PASS' : r.severity === 'INFO' ? 'INFO' : 'FAIL';
  if (!r.ok && r.severity !== 'INFO') failed++;
  console.log(`  [${tag}] ${r.name.padEnd(pad)}  ${r.detail}`);
}
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
