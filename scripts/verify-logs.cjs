// Scan the most recent Render service logs for secrets. Used by scripts/verify-launch.sh.
// Reads RENDER_API_KEY and the other vault values INSIDE this process (never from argv/env), and prints
// only counts and variable NAMES. Exit codes: 0 clean, 2 secret-shaped text or a vault value found, 3 could not fetch.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OWNER_ID = 'tea-dbgc87nb9u1s73csbdk0';
const SERVICE_ID = 'srv-dbgcbs8u01pc73ao3jkg';

const vault = new Map();
try {
  for (const line of fs.readFileSync(path.join(os.homedir(), '.config', 'synora', 'vault.env'), 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) vault.set(line.slice(0, eq), line.slice(eq + 1));
  }
} catch {
  process.exit(3);
}

const SHAPES = {
  'supabase-pat': /sbp_[0-9a-f]{40}/,
  'groq-key': /gsk_[A-Za-z0-9]{20,}/,
  'openai-style-key': /sk-[A-Za-z0-9_-]{20,}/,
  'bearer-token': /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  jwt: /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/,
  'url-with-password': /postgres(ql)?:\/\/[^:\s/@]+:[^@\s]{3,}@/,
  'private-key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
};

async function main() {
  const apiKey = vault.get('RENDER_API_KEY');
  if (!apiKey) process.exit(3);
  const url = `https://api.render.com/v1/logs?ownerId=${OWNER_ID}&resource=${SERVICE_ID}&limit=100&direction=backward`;
  let text;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.log(`log fetch -> HTTP ${res.status}`);
      process.exit(3);
    }
    text = JSON.stringify(await res.json());
  } catch {
    process.exit(3);
  }

  const hits = [];
  for (const [name, re] of Object.entries(SHAPES)) if (re.test(text)) hits.push(`shape:${name}`);
  // Exact values from the vault (skip short ones: a 4-char value would match by accident).
  for (const [name, value] of vault) {
    if (name === 'RENDER_API_KEY' || value.length < 12) continue;
    if (text.includes(value)) hits.push(`vault-value:${name}`);
  }
  console.log(`scanned ${text.length} chars of recent logs`);
  if (hits.length) {
    console.log('FOUND: ' + hits.join(', '));
    process.exit(2);
  }
  console.log('no secret-shaped text and no vault values found');
}
main();
