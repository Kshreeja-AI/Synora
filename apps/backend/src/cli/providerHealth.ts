// FIRST IMPORT, deliberately: ESM evaluates imports before any body
// statement, so the environment must be loaded by an import rather than a call.
import '../bootstrap-env';
import { initConfig } from '../config';
import { checkProviderReadiness } from '../ai/verification';

/**
 * `pnpm --filter @synora/backend providers:health`
 *
 * Turns CONFIGURED into VALID / INVALID / UNREACHABLE / NOT_VERIFIABLE by
 * making the cheapest possible AUTHENTICATED call to each configured
 * provider — typically a `GET /v1/models` listing, which generates no tokens
 * and costs nothing on every provider Synora supports.
 *
 * ── WHY THIS IS A SEPARATE COMMAND FROM THE CAPABILITY REPORT ────────────
 *
 * The capability report answers "is a key present?" for free, offline, on
 * every request path. This one answers "is the key GOOD?", which costs a
 * network round-trip and must therefore be something a human asks for
 * deliberately. Merging them would put a network call on a hot path; keeping
 * them apart is why `isConfigured()` can stay free.
 *
 * ── THE FOUR STATES ARE NEVER COLLAPSED ──────────────────────────────────
 *
 * `unreachable` is not `rejected`. A network blip reported as a bad
 * credential sends someone rotating a key that was fine; a bad credential
 * reported as a blip gets ignored until it breaks in front of a customer.
 * `not-verifiable` is the honest answer for providers with no cheap check —
 * better than implying a passing grade nobody earned.
 *
 * ── WHAT IT NEVER DOES ───────────────────────────────────────────────────
 *
 * Print, log or fingerprint a credential. Generate anything. Spend a token.
 * Unconfigured providers are listed rather than hidden, because "you have not
 * set this one up" is exactly what somebody connecting credentials needs.
 */
async function main(): Promise<void> {
  await initConfig();

  const rows = await checkProviderReadiness();
  const asJson = process.argv.includes('--json');

  if (asJson) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  process.stdout.write('\n  SYNORA TEXT PROVIDER HEALTH\n');
  process.stdout.write('  (cheapest authenticated call per provider — no generation, no tokens)\n\n');

  const width = Math.max(...rows.map((r) => r.id.length));
  let configured = 0;
  let verified = 0;

  for (const row of rows) {
    if (!row.configured) {
      process.stdout.write(`  [NOT_CONFIGURED] ${row.id.padEnd(width)}  no credential present\n`);
      continue;
    }
    configured++;
    const status = row.verification?.status ?? 'not-verifiable';
    const label =
      status === 'verified'
        ? 'VALID         '
        : status === 'rejected'
          ? 'INVALID       '
          : status === 'unreachable'
            ? 'UNKNOWN       '
            : 'NOT_VERIFIABLE';
    if (status === 'verified') verified++;
    process.stdout.write(`  [${label}] ${row.id.padEnd(width)}  ${row.verification?.detail ?? ''}\n`);
  }

  process.stdout.write(
    `\n  ${configured} configured, ${verified} credential(s) accepted by the provider.\n`
  );
  if (configured > 0 && verified === 0) {
    // Stated rather than left to be inferred: a deployment with keys that all
    // fail verification looks identical, from the capability report alone, to
    // one that is ready.
    process.stdout.write(
      '  No credential was ACCEPTED. Synora will select a provider and fail at the first\n' +
        '  real request — which a user would discover before an operator does.\n'
    );
  }
  process.stdout.write('\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `provider health check failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
