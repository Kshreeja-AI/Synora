import { spawn } from 'node:child_process';
import * as path from 'node:path';

/**
 * Collects live status by running commands that already exist.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * Every value shown in the dashboard comes from one of these calls. Nothing
 * is inferred, defaulted to green, or remembered from a previous run. A field
 * this file cannot fill stays `unknown`, and the panel renders it as
 * "not checked" — because a dashboard that guesses is worse than one that
 * admits it does not know.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COLLECT ────────────────────────────────
 *
 * Actual SPEND. That lives in the database, and this refresh must work with
 * no database — a panel that silently showed "0 cents spent" because it could
 * not reach Postgres would be the most dangerous number on the screen. The
 * configured LIMITS come from config and are shown; usage is labelled
 * unavailable.
 *
 * Credential VALIDITY. That costs a network round-trip per provider, so it
 * stays a button somebody presses (`Check Providers`), not something that
 * fires whenever a panel opens.
 */

export interface CapabilityRow {
  capability: string;
  state: string;
  providers: { id: string; displayName: string; configured: boolean; metering?: string }[];
  credentialsRequired: string[];
  note: string;
}

export interface StatusSnapshot {
  collectedAt: string;
  /** null when the command could not run at all. */
  capabilities: CapabilityRow[] | null;
  quantum: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  containers: { name: string; status: string }[] | null;
  errors: string[];
}

function run(
  program: string,
  args: string[],
  cwd: string,
  timeoutMs = 90_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message });
    });
  });
}

/**
 * Extract the fenced JSON block.
 *
 * The backend logger writes to stdout too — including secret-audit lines that
 * prove no credential VALUE was read — so the machine-readable block is
 * fenced rather than the human-readable output being silenced.
 */
function extractJson(stdout: string): unknown | null {
  const start = stdout.indexOf('<<<SYNORA-JSON>>>');
  const end = stdout.indexOf('<<<END-SYNORA-JSON>>>');
  if (start < 0 || end < 0 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start + '<<<SYNORA-JSON>>>'.length, end));
  } catch {
    return null;
  }
}

export async function collectStatus(repoRoot: string): Promise<StatusSnapshot> {
  const errors: string[] = [];

  const capabilityRun = await run(
    'npx',
    ['tsx', 'src/cli/capabilityReport.ts', '--json'],
    path.join(repoRoot, 'apps/backend')
  );
  const parsed = extractJson(capabilityRun.stdout) as
    | { capabilities?: CapabilityRow[]; quantum?: Record<string, unknown>; limits?: Record<string, unknown> }
    | null;

  if (!parsed) {
    // Named precisely, so a broken refresh is distinguishable from a broken
    // deployment. "Everything is unknown" and "the report failed" look the
    // same on a panel unless one of them says so.
    errors.push(
      `capability report did not return parseable output (exit ${capabilityRun.code ?? 'n/a'})`
    );
  }

  const dockerRun = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}'], repoRoot, 20_000);
  const containers =
    dockerRun.code === 0
      ? dockerRun.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [name, status] = line.split('\t');
            return { name: name ?? '', status: status ?? '' };
          })
      : null;
  if (containers === null) errors.push('docker is not reachable — container status is unknown');

  return {
    collectedAt: new Date().toISOString(),
    capabilities: parsed?.capabilities ?? null,
    quantum: parsed?.quantum ?? null,
    limits: parsed?.limits ?? null,
    containers,
    errors,
  };
}
