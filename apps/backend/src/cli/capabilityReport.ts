// FIRST IMPORT, deliberately: ESM evaluates imports before any body
// statement, so the environment must be loaded by an import rather than a
// call — the same reason `src/index.ts` does it.
import '../bootstrap-env';
import { getConfig, initConfig } from '../config';
import { checkCapabilityReadiness, checkQuantumReadiness } from '../ai/capabilityReadiness';
import { PROVIDER_REGISTRY } from '../ai/registry';

/**
 * `pnpm --filter @synora/backend capabilities:report`
 *
 * A developer command that prints what Synora can actually do right now, and
 * what each capability would need. It is the data source behind the VS Code
 * Control Center's Capabilities view.
 *
 * ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────
 *
 * Print a secret. Every row reports environment variable NAMES and a
 * present/absent boolean; no value, no prefix, no length, no fingerprint.
 *
 * Spend money. It calls `isConfigured()`, which is presence-only and
 * network-free by contract. Credential VALIDITY is a separate, explicit
 * command because it costs a round-trip — and on some providers, a token.
 *
 * `--json` emits machine-readable output for the Control Center; the default
 * is a table for a human reading a terminal.
 */
/**
 * What `AI_PROVIDER` is, without ever repeating what it says.
 *
 * `secret-shaped` is its own answer rather than being folded into `invalid`,
 * because the two need different responses: an unknown id is a typo, and a
 * credential in a selection variable is a key to rotate.
 */
function describeProviderSelection(
  value: string | undefined
): 'unset' | 'valid' | 'invalid' | 'secret-shaped' {
  if (!value) return 'unset';
  if (PROVIDER_REGISTRY.some((p) => p.id === value)) return 'valid';
  // Deliberately broad: any long opaque token, not just the vendor prefixes
  // this build happens to know about today.
  if (/^(sk-|r8_|ghp_|sbp_|AKIA)/.test(value) || value.length > 40) return 'secret-shaped';
  return 'invalid';
}

async function main(): Promise<void> {
  await initConfig();

  const capabilities = await checkCapabilityReadiness();
  const quantum = await checkQuantumReadiness();

  if (process.argv.includes('--json')) {
    const { ai, stage, modes } = getConfig();
    // SENTINEL-DELIMITED, because the logger also writes to stdout and its
    // secret-audit warnings interleave with anything printed here. Muting the
    // logger instead would hide exactly the audit lines that prove no secret
    // value was read — so the machine-readable block is fenced rather than the
    // human-readable one silenced. One synchronous write, so nothing can
    // interleave inside the fence.
    process.stdout.write(
      `\n<<<SYNORA-JSON>>>\n${JSON.stringify(
        {
          capabilities,
          quantum,
          // Config-only, so this stays offline and free. Actual SPEND lives in
          // the database and is deliberately NOT queried here: this command
          // must keep working with no database, and a dashboard that silently
          // needed one would report "unknown" as "zero".
          limits: {
            stage,
            mockMode: modes.mock,
            offlineMode: modes.offline,
            globalMaxCostPerDayCents: ai.globalMaxCostPerDayCents ?? null,
            globalMaxTokensPerDay: ai.globalMaxTokensPerDay ?? null,
            userMaxCostPerDayCents: ai.userMaxCostPerDayCents ?? null,
            // PRESENCE AND VALIDITY ONLY — never the value.
            //
            // This field used to emit `ai.provider` verbatim, on the
            // reasonable assumption that AI_PROVIDER holds a provider id like
            // "ollama". On 2026-08-12 it held an OpenRouter API KEY: someone
            // had pasted a credential into the selection variable, and this
            // command printed it to stdout.
            //
            // A variable that is "obviously not secret" is only obviously not
            // secret while everyone fills it in correctly. Reporting whether
            // the value NAMES A KNOWN PROVIDER is all a dashboard needs, and
            // it cannot leak whatever was actually typed there.
            providerSelection: describeProviderSelection(ai.provider),
          },
        },
        null,
        2
      )}\n<<<END-SYNORA-JSON>>>\n`
    );
    return;
  }

  process.stdout.write('\n  SYNORA CAPABILITY READINESS\n\n');
  const width = Math.max(...capabilities.map((c) => c.capability.length));

  for (const row of capabilities) {
    const configured = row.providers.filter((p) => p.configured);
    const detail =
      row.providers.length > 0
        ? `${configured.length}/${row.providers.length} provider(s) configured` +
          (configured.length > 0 ? `: ${configured.map((p) => p.id).join(', ')}` : '')
        : '—';
    process.stdout.write(`  [${row.state.padEnd(13)}] ${row.capability.padEnd(width)}  ${detail}\n`);
    process.stdout.write(`  ${' '.repeat(width + 18)}${row.note}\n`);
  }

  process.stdout.write('\n  QUANTUM\n');
  process.stdout.write(`    local simulator          available, up to ${quantum.localMaxQubits} qubits\n`);
  process.stdout.write(
    `    cloud providers          ${quantum.cloudConfigured.length > 0 ? quantum.cloudConfigured.join(', ') : 'none configured'}\n`
  );
  process.stdout.write(`    execution ceiling        level ${quantum.maxExecutionLevel}\n`);
  process.stdout.write(`    paid QPU                 ${quantum.paidQpuEnabled ? 'ENABLED' : 'disabled'}\n`);
  process.stdout.write(
    `    per-execution ceiling    ${quantum.maxCostPerExecutionCents} cents\n`
  );
  process.stdout.write(
    `    algorithms               ${quantum.executableAlgorithms.length} executable of ${quantum.describedAlgorithms} described (${quantum.executableAlgorithms.join(', ')})\n\n`
  );

  // A capability nobody can use is the thing worth surfacing at the end,
  // where someone stops reading.
  const unusable = capabilities.filter((c) => c.state === 'BLOCKED' || c.state === 'IMPLEMENTED');
  if (unusable.length > 0) {
    process.stdout.write('  NOT USABLE WITHOUT ACTION\n');
    for (const row of unusable) {
      const needs = row.credentialsRequired.length > 0 ? row.credentialsRequired.join(' | ') : 'no adapter exists';
      process.stdout.write(`    ${row.capability.padEnd(width)}  needs: ${needs}\n`);
    }
    process.stdout.write('\n');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`capability report failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
