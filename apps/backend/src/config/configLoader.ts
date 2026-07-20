import { AppConfigSchema } from './schema';
import { AppConfig } from './types';
import { detectStage } from './stage';
import { detectModes } from './modes';
import { getStageDefaults } from './defaults';
import { ConfigValidationError } from './errors';
import { secretsManager as defaultSecretsManager, SecretsManager } from '../secrets';

function readString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value && value.length > 0 ? value : fallback;
}

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readList(env: NodeJS.ProcessEnv, key: string, fallback: string[]): string[] {
  const value = env[key];
  if (!value) return fallback;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Builds the full typed AppConfig from environment variables, stage/mode
 * detection, per-stage defaults, and SecretsManager (for the handful of
 * fields that are genuinely sensitive, e.g. DATABASE_URL). Every non-secret
 * field is read from an env var with an explicit, documented default —
 * nothing here is a URL/provider/credential written directly into
 * application code.
 *
 * Throws ConfigValidationError (all violations at once) if the assembled
 * shape doesn't satisfy AppConfigSchema.
 */
export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  secrets: SecretsManager = defaultSecretsManager
): Promise<AppConfig> {
  const stage = detectStage(env);
  const modes = detectModes(env);
  const defaults = getStageDefaults(stage, modes);

  const databaseUrl = await secrets.tryGet('DATABASE_URL', 'config-loader');
  const openaiKey = await secrets.tryGet('OPENAI_API_KEY', 'config-loader');
  const anthropicKey = await secrets.tryGet('ANTHROPIC_API_KEY', 'config-loader');
  const replicateKey = await secrets.tryGet('REPLICATE_API_KEY', 'config-loader');

  const candidate = {
    stage,
    modes,
    server: {
      port: readNumber(env, 'PORT', defaults.server.port),
      corsOrigins: readList(env, 'CORS_ORIGINS', defaults.server.corsOrigins),
    },
    rateLimit: {
      windowMs: readNumber(env, 'RATE_LIMIT_WINDOW_MS', defaults.rateLimit.windowMs),
      maxRequests: readNumber(env, 'RATE_LIMIT_MAX_REQUESTS', defaults.rateLimit.maxRequests),
    },
    logging: {
      level: readString(env, 'LOG_LEVEL', defaults.logging.level) as AppConfig['logging']['level'],
    },
    auth: {
      jwtExpiry: readString(env, 'JWT_EXPIRY', defaults.auth.jwtExpiry),
      jwtRefreshExpiry: readString(env, 'JWT_REFRESH_EXPIRY', defaults.auth.jwtRefreshExpiry),
    },
    urls: {
      backendUrl: readString(env, 'BACKEND_URL', defaults.urls.backendUrl),
      frontendUrl: readString(env, 'FRONTEND_URL', defaults.urls.frontendUrl),
    },
    database: {
      // Placeholder-mode DATABASE_URL is still a string (deterministic fake
      // dsn-shaped value from SecretsManager), so this is never undefined
      // in development/testing/qa; staging/production would already have
      // failed SecretsManager.validateRequired() before loadConfig() runs.
      url: databaseUrl ?? '',
    },
    providers: {
      openaiEnabled: Boolean(openaiKey),
      anthropicEnabled: Boolean(anthropicKey),
      replicateEnabled: Boolean(replicateKey),
    },
  };

  const result = AppConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }

  return result.data;
}
