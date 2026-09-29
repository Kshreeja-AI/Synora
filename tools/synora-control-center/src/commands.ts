/**
 * The single list of what the Control Center can run.
 *
 * ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────
 *
 * Every entry is a command that ALREADY EXISTS in the repository and that a
 * developer could type themselves. The Control Center runs them and shows the
 * real output; it does not reimplement any of them, does not have a "quick"
 * variant that skips something, and does not interpret an exit code as
 * anything other than what it is.
 *
 * That constraint is what keeps this a view rather than a second system. The
 * moment a button does something the terminal cannot, the button becomes the
 * source of truth for a behaviour nobody can reproduce or review.
 *
 * ── AND WHY NOTHING HERE DEPLOYS ─────────────────────────────────────────
 *
 * There is no deploy button, no DNS button, no migrate-production button, no
 * "start the VPS" button. Those are the operations where a misclick is not
 * recoverable, and a developer UI is exactly where a misclick happens. They
 * stay in a terminal where the operator has to mean it.
 */

export interface ControlCommand {
  readonly id: string;
  readonly label: string;
  /** What it answers, in one line, for someone who is not an engineer. */
  readonly purpose: string;
  readonly program: string;
  readonly args: readonly string[];
  /** Relative to the repository root. */
  readonly cwd: string;
  /** Roughly how long to expect, so a slow command does not look hung. */
  readonly expect: string;
  /** True when the command reaches the network. Nothing here spends money. */
  readonly network: boolean;
}

export const CONTROL_COMMANDS: readonly ControlCommand[] = [
  {
    id: 'synora.runTests',
    label: 'Run Backend Tests',
    purpose: 'The full backend suite. Needs PostgreSQL reachable for the route tests.',
    program: 'npx',
    args: ['vitest', 'run'],
    cwd: 'apps/backend',
    expect: '~20 minutes',
    network: false,
  },
  {
    id: 'synora.runWebTests',
    label: 'Run Web Tests',
    purpose: 'The frontend component suite.',
    program: 'npx',
    args: ['vitest', 'run'],
    cwd: 'apps/web',
    expect: '~1 minute',
    network: false,
  },
  {
    id: 'synora.typecheck',
    label: 'Typecheck',
    purpose: 'TypeScript across every package. Catches contract breaks the tests would miss.',
    program: 'pnpm',
    args: ['run', 'type-check'],
    cwd: '.',
    expect: '~2 minutes',
    network: false,
  },
  {
    id: 'synora.lint',
    label: 'Lint',
    purpose: 'ESLint across the backend.',
    program: 'npx',
    args: ['eslint', 'src', '--ext', '.ts'],
    cwd: 'apps/backend',
    expect: '~1 minute',
    network: false,
  },
  {
    id: 'synora.audit',
    label: 'Dependency Audit',
    purpose: 'Known vulnerabilities in installed packages.',
    program: 'pnpm',
    args: ['audit', '--audit-level', 'low'],
    cwd: '.',
    expect: '~30 seconds',
    network: true,
  },
  {
    id: 'synora.guardrails',
    label: 'Security Guardrails',
    purpose: 'Tracked secrets, placeholder credentials, vendor coupling, exposed ports.',
    program: 'node',
    args: ['scripts/guardrails.mjs'],
    cwd: '.',
    expect: 'seconds',
    network: false,
  },
  {
    id: 'synora.capabilities',
    label: 'Capability Report',
    purpose: 'What Synora can actually do right now, and what each capability still needs.',
    program: 'npx',
    args: ['tsx', 'src/cli/capabilityReport.ts'],
    cwd: 'apps/backend',
    expect: 'seconds',
    network: false,
  },
  {
    id: 'synora.providerHealth',
    label: 'Check Providers',
    purpose:
      'Turns CONFIGURED into VALID/INVALID. Cheapest authenticated call per provider — no generation, no tokens.',
    program: 'npx',
    args: ['tsx', 'src/cli/providerHealth.ts'],
    cwd: 'apps/backend',
    expect: '~10 seconds',
    // It authenticates against each configured provider. That is the point,
    // and it is why this is a button somebody presses rather than something
    // that runs on open.
    network: true,
  },
  {
    id: 'synora.smokeText',
    label: 'Text Smoke Test',
    purpose:
      'ONE real generation through the full abstraction. Refuses automatically if the resolved provider would bill.',
    program: 'npx',
    args: ['tsx', 'src/cli/textSmokeTest.ts'],
    cwd: 'apps/backend',
    expect: 'seconds to a minute',
    network: true,
  },
  {
    id: 'synora.checkDocker',
    label: 'Check Docker',
    purpose: 'Which containers are running, and whether they are healthy.',
    program: 'docker',
    args: ['ps', '--format', '{{.Names}}\t{{.Status}}'],
    cwd: '.',
    expect: 'seconds',
    network: false,
  },
  {
    id: 'synora.checkEnv',
    label: 'Check Environment',
    purpose: 'Which settings are present. Reports names and status only — never a value.',
    program: 'powershell',
    args: ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-env.ps1'],
    cwd: '.',
    expect: 'seconds',
    network: false,
  },
  {
    id: 'synora.smokeTest',
    label: 'Local Smoke Test',
    purpose: 'The fast subset: quantum, knowledge and orchestration. No database needed.',
    program: 'npx',
    args: ['vitest', 'run', 'src/quantum', 'src/knowledge', 'src/intelligence', 'src/ai'],
    cwd: 'apps/backend',
    expect: '~1 minute',
    network: false,
  },
];

export function findCommand(id: string): ControlCommand | undefined {
  return CONTROL_COMMANDS.find((c) => c.id === id);
}
