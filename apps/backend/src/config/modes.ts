import { OperatingMode, OperatingModeFlags } from './types';
import { OperatingModeSchema } from './schema';

const BOOLEAN_ENV_KEYS: Record<keyof OperatingModeFlags, string> = {
  offline: 'OFFLINE_MODE',
  mock: 'MOCK_MODE',
  enterprise: 'ENTERPRISE_MODE',
  government: 'GOVERNMENT_MODE',
  selfHosted: 'SELF_HOSTED_MODE',
};

function readBoolean(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key]?.toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Modes can be set two ways, unioned together:
 *  - discrete booleans (OFFLINE_MODE=true, MOCK_MODE=true, ...) — the
 *    primary, explicit mechanism, one var per mode.
 *  - APP_MODES=mock,offline — a convenience for platforms where setting
 *    several discrete booleans is awkward (e.g. a single CI matrix var).
 * Either is sufficient on its own; using both is fine, they just OR
 * together.
 */
export function detectModes(env: NodeJS.ProcessEnv = process.env): OperatingModeFlags {
  const flags: OperatingModeFlags = {
    offline: readBoolean(env, BOOLEAN_ENV_KEYS.offline),
    mock: readBoolean(env, BOOLEAN_ENV_KEYS.mock),
    enterprise: readBoolean(env, BOOLEAN_ENV_KEYS.enterprise),
    government: readBoolean(env, BOOLEAN_ENV_KEYS.government),
    selfHosted: readBoolean(env, BOOLEAN_ENV_KEYS.selfHosted),
  };

  const csv = env.APP_MODES?.split(',').map((m) => m.trim().toLowerCase()) ?? [];
  for (const raw of csv) {
    const parsed = OperatingModeSchema.safeParse(raw);
    if (!parsed.success) continue;
    applyMode(flags, parsed.data);
  }

  return flags;
}

function applyMode(flags: OperatingModeFlags, mode: OperatingMode): void {
  switch (mode) {
    case 'offline':
      flags.offline = true;
      break;
    case 'mock':
      flags.mock = true;
      break;
    case 'enterprise':
      flags.enterprise = true;
      break;
    case 'government':
      flags.government = true;
      break;
    case 'self-hosted':
      flags.selfHosted = true;
      break;
  }
}
