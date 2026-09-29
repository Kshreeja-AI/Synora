import { SECRET_CATALOG } from '../secrets/registry';

/**
 * WHAT A PERSON SETTING UP SYNORA ACTUALLY HAS TO DO.
 *
 * Synora reads 161 environment variables. 134 are tuning knobs with working
 * defaults — batch sizes, retry counts, model names — and listing all of
 * them as things to "decide" turns a ten-minute setup into an afternoon of
 * reading. This catalogue is deliberately NOT all 161. It is the short list
 * that actually needs a human, plus the shorter list Synora fills in by
 * itself.
 *
 * ─── WHY THREE LABELS AND NOT ONE ───────────────────────────────────────
 *
 * The obvious design is a single label per variable: required, optional,
 * generated, public, or secret. It cannot express the most important case.
 * `JWT_SECRET` is required, AND secret, AND something Synora generates for
 * you — and that combination is the whole point, because it is the category
 * where the person setting up does NOTHING. Forcing one label would hide
 * exactly the fact worth surfacing.
 *
 * So three independent questions, each with a real consequence:
 *
 *   necessity   REQUIRED  — production refuses to start without it
 *               OPTIONAL  — a feature stays off, nothing breaks
 *   sensitivity SECRET    — never logged, never in git, never in a build
 *                           argument, rotate if exposed
 *               PUBLIC    — every visitor can read it out of the page
 *   provenance  GENERATED — Synora creates it; nobody types it
 *               SUPPLIED  — only a human or another system can provide it
 *
 * ─── WHAT COUNTS AS GENERATED ───────────────────────────────────────────
 *
 * Exactly the secrets that are pure random bytes with no counterparty: a
 * key Synora invents and only Synora needs. A vendor API key is not
 * generatable — a random string is not an account. A database URL is not
 * generatable — it describes a server that already exists. Getting this
 * boundary wrong in the generous direction would be worse than useless: it
 * would write a confident-looking fake value into a real settings file.
 */

export type Necessity = 'REQUIRED' | 'OPTIONAL';
export type Sensitivity = 'SECRET' | 'PUBLIC';
export type Provenance = 'GENERATED' | 'SUPPLIED';

export interface EnvVariable {
  name: string;
  necessity: Necessity;
  sensitivity: Sensitivity;
  provenance: Provenance;
  /** One line, for someone who is not an engineer. */
  purpose: string;
  /** What breaks if it is wrong or missing. Empty for OPTIONAL. */
  consequence?: string;
  /** Bytes of randomness when GENERATED. Never a value — this file holds none. */
  generateBytes?: number;
}

/**
 * The secrets Synora can create for itself.
 *
 * 32 bytes, base64 — the same strength `openssl rand -base64 32` produces,
 * which is what every document told a person to run by hand. Doing it for
 * them removes the three commands most likely to be skipped, mistyped, or
 * pasted into a chat window.
 */
const GENERATED_SECRETS: Record<string, { bytes: number; purpose: string; consequence: string }> = {
  JWT_SECRET: {
    bytes: 32,
    purpose: 'Signs the tokens that keep someone logged in.',
    consequence: 'Nobody can sign in. If it leaks, anyone can forge a login as anyone.',
  },
  NEXTAUTH_SECRET: {
    bytes: 32,
    purpose: 'Encrypts session cookies in the browser.',
    consequence: 'Sessions cannot be read. If it leaks, sessions can be forged.',
  },
  TOOL_SECRET_MASTER_KEY: {
    bytes: 32,
    purpose: 'Encrypts the credentials people store for their own tools.',
    consequence: 'Stored tool credentials cannot be decrypted, and new ones cannot be saved.',
  },
};

/**
 * The variables a human genuinely has to decide, beyond the generated ones.
 *
 * Every entry here is either required for production or the difference
 * between a working deployment and a silently broken one. The three URL
 * entries are enforced at boot — see `assertNoLocalhostInProduction`, added
 * after a production boot with all three unset resolved every one to
 * localhost without a word of complaint.
 */
const SUPPLIED_REQUIRED: EnvVariable[] = [
  {
    name: 'DATABASE_URL',
    necessity: 'REQUIRED',
    sensitivity: 'SECRET',
    provenance: 'SUPPLIED',
    purpose: 'Where the database lives, including its password.',
    consequence: 'Synora cannot start at all.',
  },
  {
    name: 'CORS_ORIGINS',
    necessity: 'REQUIRED',
    sensitivity: 'PUBLIC',
    provenance: 'SUPPLIED',
    purpose: 'Which website addresses are allowed to talk to the API.',
    consequence:
      'The site loads and nothing works: every request and live connection from the real domain is refused.',
  },
  {
    name: 'FRONTEND_URL',
    necessity: 'REQUIRED',
    sensitivity: 'PUBLIC',
    provenance: 'SUPPLIED',
    purpose: 'The public address of the website, used to build links inside emails.',
    consequence:
      "Every password reset, verification and invitation email links to the recipient's own machine.",
  },
  {
    name: 'BACKEND_URL',
    necessity: 'REQUIRED',
    sensitivity: 'PUBLIC',
    provenance: 'SUPPLIED',
    purpose: 'The public address of the API, used to build links to uploaded files.',
    consequence: 'Uploaded files and avatars resolve to an address no visitor can reach.',
  },
  {
    name: 'NEXT_PUBLIC_API_URL',
    necessity: 'REQUIRED',
    sensitivity: 'PUBLIC',
    provenance: 'SUPPLIED',
    purpose: 'The API address the browser calls. Belongs to the WEBSITE, not the API.',
    consequence:
      'Baked in when the site is BUILT, not read when it starts — a build without it produces a site that calls localhost from the visitor\'s own machine. Rebuild to change it.',
  },
];

/**
 * A spend cap is not required to boot, but a PAID provider key without one
 * is refused (`assertProductionLaunchGates`). Listed so the pairing is
 * visible before someone connects a key and discovers the rule.
 */
const SPEND_CAPS: EnvVariable[] = [
  {
    name: 'AI_GLOBAL_MAX_COST_PER_DAY_CENTS',
    necessity: 'OPTIONAL',
    sensitivity: 'PUBLIC',
    provenance: 'SUPPLIED',
    purpose: 'Daily spending ceiling, in cents. Required before any paid AI key will boot.',
  },
  {
    name: 'AI_GLOBAL_MAX_TOKENS_PER_DAY',
    necessity: 'OPTIONAL',
    sensitivity: 'PUBLIC',
    provenance: 'SUPPLIED',
    purpose: 'Daily token ceiling. What bounds a self-hosted model, which has no per-token price.',
  },
];

function generatedEntries(): EnvVariable[] {
  return Object.entries(GENERATED_SECRETS).map(([name, spec]) => ({
    name,
    necessity: 'REQUIRED' as const,
    sensitivity: 'SECRET' as const,
    provenance: 'GENERATED' as const,
    purpose: spec.purpose,
    consequence: spec.consequence,
    generateBytes: spec.bytes,
  }));
}

/** Everything a person has to think about, in setup order. */
export const ENV_CATALOG: readonly EnvVariable[] = Object.freeze([
  ...generatedEntries(),
  ...SUPPLIED_REQUIRED,
  ...SPEND_CAPS,
]);

/** The ones Synora fills in, so nobody has to run `openssl` three times. */
export function generatedVariables(): EnvVariable[] {
  return ENV_CATALOG.filter((v) => v.provenance === 'GENERATED');
}

/** The short list that genuinely needs a human. */
export function suppliedRequiredVariables(): EnvVariable[] {
  return ENV_CATALOG.filter((v) => v.necessity === 'REQUIRED' && v.provenance === 'SUPPLIED');
}

/**
 * Every catalogued name that the secret registry also knows about.
 *
 * Used by the tests to prove the two agree: a variable this file calls
 * SECRET must really be in the registry (or it gets none of the registry's
 * protections — no rotation policy, no production refusal of a leaked dev
 * value), and a GENERATED secret must be one the registry requires.
 */
export function catalogSecretNames(): string[] {
  return ENV_CATALOG.filter((v) => v.sensitivity === 'SECRET').map((v) => v.name);
}

export function registrySecretNames(): string[] {
  return SECRET_CATALOG.map((s) => s.key);
}
