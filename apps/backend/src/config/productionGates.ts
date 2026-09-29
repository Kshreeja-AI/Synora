import type { AppConfig } from './types';

/**
 * Launch gates that only hold where real money and real users exist.
 * Separate from schema validation because the rule crosses two systems:
 * whether a METERED provider credential exists is SecretsManager's answer,
 * whether a spend cap exists is config's — and "no paid key without a cap"
 * belongs to neither alone.
 *
 * The launch runbook classifies AI_GLOBAL_MAX_COST_PER_DAY_CENTS /
 * AI_GLOBAL_MAX_TOKENS_PER_DAY as REQUIRED_PRODUCTION with the note "set
 * BEFORE any paid key". This module is what makes that sentence
 * enforceable instead of aspirational: a staging/production boot that
 * resolves a real metered credential while no global cap is configured
 * does not come up.
 *
 * Ollama and self-hosted endpoints are deliberately exempt: an endpoint
 * the operator runs is not a bill that scales with tokens, and their
 * absence from this list is what keeps the free/self-hosted path booting
 * with zero cap configuration. Vector-DB credentials (Pinecone etc.) are
 * also out of scope — they are metered by storage, not by generation, and
 * the AI spend guard does not meter them.
 */

/**
 * Every credential that lets Synora send tokens to a party that bills for
 * them. Groq has a free tier but paid tiers exist behind the same key;
 * Voyage/Cohere are embeddings — embeddings are metered too.
 */
export const METERED_AI_CREDENTIALS: readonly string[] = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'REPLICATE_API_KEY',
  'GOOGLE_AI_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'GROQ_API_KEY',
  'VOYAGE_API_KEY',
  'COHERE_API_KEY',
];

export class ProductionGateError extends Error {
  constructor(meteredKeys: string[]) {
    super(
      `Refusing to start: metered AI credential(s) configured (${meteredKeys.join(', ')}) ` +
        'but no global spend cap is set. Set AI_GLOBAL_MAX_COST_PER_DAY_CENTS (recommended) ' +
        'and/or AI_GLOBAL_MAX_TOKENS_PER_DAY before booting with a paid provider key — ' +
        'an uncapped key is an uncontrolled bill. See docs/production/LAUNCH_RUNBOOK.md §2.'
    );
    this.name = 'ProductionGateError';
  }
}

/* ------------------------------------------------------------------ *
 * A LOCALHOST DEFAULT MUST NOT REACH PRODUCTION
 * ------------------------------------------------------------------ */

/**
 * `CORS_ORIGINS`, `FRONTEND_URL` and `BACKEND_URL` all default to
 * `http://localhost:300x`, and — verified by booting the real config with
 * `DEPLOYMENT_STAGE=production` and those variables unset — **production
 * does not override them**. `STAGE_OVERRIDES` in defaults.ts touches only
 * logging and rate limits.
 *
 * So a production deployment that forgets any one of them starts cleanly,
 * passes every health check, logs nothing unusual, and is broken:
 *
 *  - `CORS_ORIGINS` — the browser at the real domain has its API calls
 *    rejected, because the only permitted origin is localhost. Since the
 *    realtime layer was unified onto this same list, presence and live
 *    updates fail with it. The site loads and nothing works.
 *  - `FRONTEND_URL` — every email verification, password reset and
 *    workspace invitation link points at the RECIPIENT'S OWN MACHINE.
 *    Every email Synora sends is unusable, and the send itself succeeds.
 *  - `BACKEND_URL` — every uploaded file's public URL points at localhost,
 *    so no avatar or attachment loads for anyone.
 *
 * None of the three is ever legitimately loopback in production: all three
 * are consumed by a REMOTE BROWSER, not by a server-to-server call on the
 * box. (A loopback value for an internal service-to-service address would
 * be reasonable — that is simply not what these are for.) So this gate can
 * refuse without a configuration escape hatch.
 *
 * Development, testing and qa are untouched: localhost is the correct
 * answer there, and the same soft/hard stage split the credential gate
 * above uses applies here.
 *
 * NOT CHECKED: whether the scheme is https. A deployment terminating TLS
 * at a proxy can have legitimate reasons for plain http on an internal
 * hop, and refusing on that would be an opinion rather than a fact. The
 * loopback host is the fact.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

/** True when this URL would send a browser back to its own machine. */
export function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    // Unparseable is not this gate's problem — the schema validates shape.
    // Reporting it as loopback would blame the wrong thing.
    return false;
  }
}

export class LocalhostInProductionError extends Error {
  constructor(offenders: { name: string; value: string; consequence: string }[]) {
    super(
      'Refusing to start: production is configured with localhost addresses that only ' +
        'work on the machine itself.\n' +
        offenders.map((o) => `  - ${o.name}=${o.value} — ${o.consequence}`).join('\n') +
        '\nSet each to the real public address (for example https://synora.example.com). ' +
        'These have development defaults on purpose, and a default that survives to ' +
        'production breaks the product silently — nothing else would have reported it.'
    );
    this.name = 'LocalhostInProductionError';
  }
}

/**
 * Refuse a staging/production boot whose browser-facing addresses are
 * still pointing at the machine itself.
 *
 * Checks the RESOLVED configuration, not whether an environment variable
 * was present: the value can legitimately arrive from any secret source,
 * and what matters is the address the product will actually hand to a
 * browser.
 */
export function assertNoLocalhostInProduction(
  config: Pick<AppConfig, 'stage'> & {
    server: Pick<AppConfig['server'], 'corsOrigins'>;
    urls: Pick<AppConfig['urls'], 'frontendUrl' | 'backendUrl'>;
  }
): void {
  if (config.stage !== 'staging' && config.stage !== 'production') return;

  const offenders: { name: string; value: string; consequence: string }[] = [];

  const loopbackOrigins = config.server.corsOrigins.filter(isLoopbackUrl);
  if (loopbackOrigins.length > 0 && loopbackOrigins.length === config.server.corsOrigins.length) {
    // Only when EVERY origin is loopback. A real deployment may keep a
    // localhost entry alongside the real domain so a developer can point a
    // local frontend at staging; that is deliberate and harmless. Having
    // nothing BUT localhost is the unset default.
    offenders.push({
      name: 'CORS_ORIGINS',
      value: config.server.corsOrigins.join(','),
      consequence: 'the real site\'s browser requests and realtime connections are all rejected',
    });
  }
  if (isLoopbackUrl(config.urls.frontendUrl)) {
    offenders.push({
      name: 'FRONTEND_URL',
      value: config.urls.frontendUrl,
      consequence: 'password reset, email verification and invitation links point at the recipient\'s own machine',
    });
  }
  if (isLoopbackUrl(config.urls.backendUrl)) {
    offenders.push({
      name: 'BACKEND_URL',
      value: config.urls.backendUrl,
      consequence: 'uploaded files and avatars resolve to an address no visitor can reach',
    });
  }

  if (offenders.length > 0) {
    throw new LocalhostInProductionError(offenders);
  }
}

/** The one SecretsManager capability this gate needs — keeps tests honest and small. */
interface RealCredentialCheck {
  hasReal(key: string, actor?: string): Promise<boolean>;
}

/**
 * Call once at boot, after initConfig(). Throws ProductionGateError in
 * staging/production when a real metered credential resolves and neither
 * global spend cap is configured. Development/testing/qa never throw —
 * the same soft/hard stage split validateRequired() uses.
 */
export async function assertProductionLaunchGates(
  config: Pick<AppConfig, 'stage'> & { ai: Pick<AppConfig['ai'], 'globalMaxCostPerDayCents' | 'globalMaxTokensPerDay'> },
  secrets: RealCredentialCheck
): Promise<void> {
  if (config.stage !== 'staging' && config.stage !== 'production') return;

  const capsConfigured =
    config.ai.globalMaxCostPerDayCents !== undefined ||
    config.ai.globalMaxTokensPerDay !== undefined;
  if (capsConfigured) return;

  const metered: string[] = [];
  for (const key of METERED_AI_CREDENTIALS) {
    if (await secrets.hasReal(key, 'production-gates')) {
      metered.push(key);
    }
  }

  if (metered.length > 0) {
    throw new ProductionGateError(metered);
  }
}

/* ------------------------------------------------------------------ *
 * PAID QUANTUM HARDWARE MUST NOT BE REACHABLE WITHOUT A CEILING
 * ------------------------------------------------------------------ */

export class QuantumGateError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to start: ${reason} Paid QPU execution is billed per task and per shot, ` +
        'and a task can cost more than a month of text generation. Set ' +
        'QUANTUM_MAX_COST_PER_EXECUTION_CENTS to a real ceiling, or unset ' +
        'QUANTUM_PAID_QPU_ENABLED. See SYNORA_MASTER_BLUEPRINT.md, Part XI.'
    );
    this.name = 'QuantumGateError';
  }
}

/**
 * The quantum twin of `assertProductionLaunchGates`, and a separate function
 * for a reason: the AI gate asks "is there a metered credential without a
 * cap?", which is the right question for token billing. Quantum billing is
 * not token-shaped — a single QPU task has a price of its own — so the
 * equivalent question is "is the paid rung switched on without a
 * per-execution ceiling?".
 *
 * Folding quantum into `METERED_AI_CREDENTIALS` would have been shorter and
 * wrong: it would force an AI token cap to be set before a quantum
 * credential could exist, and it would leave the actual failure — paid QPU
 * enabled, ceiling still zero — completely unchecked.
 *
 * Development and testing are untouched: neither can reach level 3 anyway
 * without the same two flags, and refusing a developer's boot for a rung
 * they have deliberately enabled locally would be noise.
 */
export function assertQuantumLaunchGates(
  config: Pick<AppConfig, 'stage'> & {
    quantum: Pick<
      AppConfig['quantum'],
      'paidQpuEnabled' | 'maxCostPerExecutionCents' | 'maxExecutionLevel'
    >;
  }
): void {
  if (config.stage !== 'staging' && config.stage !== 'production') return;
  if (!config.quantum.paidQpuEnabled) return;

  if (config.quantum.maxCostPerExecutionCents <= 0) {
    throw new QuantumGateError(
      'QUANTUM_PAID_QPU_ENABLED is set while QUANTUM_MAX_COST_PER_EXECUTION_CENTS is 0.'
    );
  }
  if (config.quantum.maxExecutionLevel < 3) {
    // Not an error — the two flags simply disagree, and the stricter one
    // wins at runtime. Saying so at boot beats an operator concluding the
    // enablement flag is broken.
    return;
  }
}

export class DevelopmentModeInProductionError extends Error {
  constructor(readonly modes: string[]) {
    super(
      `Refusing to start: production has development modes active (${modes.join(', ')}). ` +
        'Mock mode answers with fabricated output instead of a model, and offline mode ' +
        'suppresses outbound calls — either one silently turns a production deployment ' +
        'into a demo. Unset them, or run this configuration in a development stage.'
    );
    this.name = 'DevelopmentModeInProductionError';
  }
}

/**
 * Call once at boot, after initConfig(). Refuses staging/production when mock
 * or offline mode is active.
 *
 * WHY A GATE AND NOT A COMMENT. `MOCK_MODE` and `OFFLINE_MODE` are ordinary
 * environment booleans, and a mock provider is registered in the streaming
 * resolver. Nothing else in the codebase stops a stray variable — copied from
 * a development file, set by a platform's UI, inherited from a shell — from
 * putting a production deployment into a state where every "AI answer" is
 * fabricated and no outbound request is ever made. That failure is invisible
 * from the outside: the app is healthy, requests return 200, the text looks
 * plausible, and the only symptom is that none of it came from a model.
 *
 * This is the same shape as `assertNoLocalhostInProduction`: a configuration
 * that is correct in development and catastrophic in production, refused at
 * boot rather than discovered by a customer. Development, testing and qa are
 * untouched — mock and offline are the point there.
 */
export function assertNoDevelopmentModesInProduction(
  config: Pick<AppConfig, 'stage' | 'modes'>
): void {
  if (config.stage !== 'staging' && config.stage !== 'production') return;

  const active: string[] = [];
  if (config.modes.mock) active.push('MOCK_MODE');
  if (config.modes.offline) active.push('OFFLINE_MODE');

  if (active.length > 0) {
    throw new DevelopmentModeInProductionError(active);
  }
}
