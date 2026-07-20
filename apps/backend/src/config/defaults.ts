import { DeploymentStage, OperatingModeFlags } from './types';

/**
 * The subset of AppConfig that has a sane default per stage. Fields that
 * must always come from a real value with no safe default (database URL,
 * provider keys) are deliberately absent — those are resolved via
 * SecretsManager, which has its own placeholder-vs-required rules.
 */
export interface StageDefaults {
  server: {
    port: number;
    corsOrigins: string[];
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
  };
  auth: {
    jwtExpiry: string;
    jwtRefreshExpiry: string;
  };
  urls: {
    backendUrl: string;
    frontendUrl: string;
  };
}

const BASE_DEFAULTS: StageDefaults = {
  server: {
    port: 3001,
    corsOrigins: ['http://localhost:3000'],
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
  },
  logging: {
    level: 'info',
  },
  auth: {
    jwtExpiry: '15m',
    jwtRefreshExpiry: '7d',
  },
  urls: {
    backendUrl: 'http://localhost:3001',
    frontendUrl: 'http://localhost:3000',
  },
};

const STAGE_OVERRIDES: Partial<Record<DeploymentStage, Partial<StageDefaults>>> = {
  development: {
    logging: { level: 'debug' },
  },
  testing: {
    logging: { level: 'warn' },
    rateLimit: { windowMs: 60 * 1000, maxRequests: 1000 }, // generous — test suites shouldn't get rate-limited
  },
  qa: {
    logging: { level: 'debug' },
  },
  staging: {
    logging: { level: 'info' },
  },
  production: {
    logging: { level: 'warn' },
    rateLimit: { windowMs: 15 * 60 * 1000, maxRequests: 60 }, // stricter than dev by default
  },
};

/**
 * Enterprise mode tightens the production defaults further; it does not
 * introduce new fields, it just changes the numbers a stage would
 * otherwise default to. This is the one concrete behavioral hook wired
 * for "Enterprise Mode" today — see docs/operations/ENVIRONMENT_MANAGEMENT.md
 * for the rest of its (currently documentation-only) contract.
 */
function applyModeOverrides(defaults: StageDefaults, modes: OperatingModeFlags): StageDefaults {
  if (!modes.enterprise) return defaults;

  return {
    ...defaults,
    rateLimit: {
      windowMs: defaults.rateLimit.windowMs,
      maxRequests: Math.min(defaults.rateLimit.maxRequests, 30),
    },
  };
}

export function getStageDefaults(stage: DeploymentStage, modes: OperatingModeFlags): StageDefaults {
  const override = STAGE_OVERRIDES[stage] ?? {};
  const merged: StageDefaults = {
    server: { ...BASE_DEFAULTS.server, ...override.server },
    rateLimit: { ...BASE_DEFAULTS.rateLimit, ...override.rateLimit },
    logging: { ...BASE_DEFAULTS.logging, ...override.logging },
    auth: { ...BASE_DEFAULTS.auth, ...override.auth },
    urls: { ...BASE_DEFAULTS.urls, ...override.urls },
  };

  return applyModeOverrides(merged, modes);
}
