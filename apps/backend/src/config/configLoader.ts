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
      jwtRefreshExpiryRememberMe: readString(
        env,
        'JWT_REFRESH_EXPIRY_REMEMBER_ME',
        defaults.auth.jwtRefreshExpiryRememberMe
      ),
      maxFailedLoginAttempts: readNumber(
        env,
        'MAX_FAILED_LOGIN_ATTEMPTS',
        defaults.auth.maxFailedLoginAttempts
      ),
      lockoutDurationMinutes: readNumber(
        env,
        'LOCKOUT_DURATION_MINUTES',
        defaults.auth.lockoutDurationMinutes
      ),
      passwordResetTokenExpiry: readString(
        env,
        'PASSWORD_RESET_TOKEN_EXPIRY',
        defaults.auth.passwordResetTokenExpiry
      ),
      emailVerificationTokenExpiry: readString(
        env,
        'EMAIL_VERIFICATION_TOKEN_EXPIRY',
        defaults.auth.emailVerificationTokenExpiry
      ),
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
    ai: {
      provider: env.AI_PROVIDER || undefined,
      anthropicModel: readString(env, 'ANTHROPIC_MODEL', defaults.ai.anthropicModel),
      openaiModel: readString(env, 'OPENAI_MODEL', defaults.ai.openaiModel),
      geminiModel: readString(env, 'GEMINI_MODEL', defaults.ai.geminiModel),
      xaiModel: readString(env, 'XAI_MODEL', defaults.ai.xaiModel),
      openrouterModel: readString(env, 'OPENROUTER_MODEL', defaults.ai.openrouterModel),
      deepseekModel: readString(env, 'DEEPSEEK_MODEL', defaults.ai.deepseekModel),
      togetherModel: readString(env, 'TOGETHER_MODEL', defaults.ai.togetherModel),
      azureOpenAIEndpoint: env.AZURE_OPENAI_ENDPOINT || undefined,
      azureOpenAIDeployment: env.AZURE_OPENAI_DEPLOYMENT || undefined,
      azureOpenAIApiVersion: readString(
        env,
        'AZURE_OPENAI_API_VERSION',
        defaults.ai.azureOpenAIApiVersion
      ),
      // No default: unlike every other field here, AWS_ACCESS_KEY_ID/
      // AWS_SECRET_ACCESS_KEY are extremely common ambient env vars in any
      // AWS-hosted deployment (ECS task roles, EC2 instance profiles, CI/CD)
      // for reasons entirely unrelated to AI generation. Requiring an
      // explicit BEDROCK_REGION (no fallback) is what makes Bedrock
      // opt-in rather than silently auto-activated by unrelated AWS
      // credentials — see bedrock.provider.ts's isConfigured().
      bedrockRegion: env.BEDROCK_REGION || undefined,
      bedrockModelId: readString(env, 'BEDROCK_MODEL_ID', defaults.ai.bedrockModelId),
      ollamaBaseUrl: env.OLLAMA_BASE_URL || undefined,
      ollamaModel: readString(env, 'OLLAMA_MODEL', defaults.ai.ollamaModel),
    },
    mail: {
      transport: readString(env, 'MAIL_TRANSPORT', defaults.mail.transport) as AppConfig['mail']['transport'],
      fromAddress: readString(env, 'MAIL_FROM_ADDRESS', defaults.mail.fromAddress),
      fromName: readString(env, 'MAIL_FROM_NAME', defaults.mail.fromName),
      smtpHost: env.SMTP_HOST || undefined,
      smtpPort: readNumber(env, 'SMTP_PORT', defaults.mail.smtpPort),
      smtpSecure: readString(env, 'SMTP_SECURE', String(defaults.mail.smtpSecure)) === 'true',
    },
    storage: {
      provider: readString(env, 'STORAGE_PROVIDER', defaults.storage.provider) as AppConfig['storage']['provider'],
      localDirectory: readString(env, 'STORAGE_LOCAL_DIRECTORY', defaults.storage.localDirectory),
      publicBasePath: readString(env, 'STORAGE_PUBLIC_BASE_PATH', defaults.storage.publicBasePath),
      maxUploadBytes: readNumber(env, 'STORAGE_MAX_UPLOAD_BYTES', defaults.storage.maxUploadBytes),
      maxAssetUploadBytes: readNumber(
        env,
        'STORAGE_MAX_ASSET_UPLOAD_BYTES',
        defaults.storage.maxAssetUploadBytes
      ),
    },
    billing: {
      provider: readString(env, 'BILLING_PROVIDER', defaults.billing.provider) as AppConfig['billing']['provider'],
      defaultCurrency: readString(env, 'BILLING_DEFAULT_CURRENCY', defaults.billing.defaultCurrency),
      trialDays: readNumber(env, 'BILLING_TRIAL_DAYS', defaults.billing.trialDays),
    },
    queue: {
      enabled: readString(env, 'QUEUE_ENABLED', String(defaults.queue.enabled)) === 'true',
      redis: {
        url: env.REDIS_URL || undefined,
        host: env.REDIS_HOST || undefined,
        port: env.REDIS_PORT ? readNumber(env, 'REDIS_PORT', 6379) : undefined,
        password: env.REDIS_PASSWORD || undefined,
        db: env.REDIS_DB ? readNumber(env, 'REDIS_DB', 0) : undefined,
        tls: env.REDIS_TLS ? env.REDIS_TLS === 'true' : undefined,
        maxRetriesPerRequest: env.REDIS_MAX_RETRIES_PER_REQUEST
          ? readNumber(env, 'REDIS_MAX_RETRIES_PER_REQUEST', 20)
          : undefined,
        enableReadyCheck: readString(env, 'REDIS_ENABLE_READY_CHECK', 'true') === 'true',
        enableOfflineQueue: readString(env, 'REDIS_ENABLE_OFFLINE_QUEUE', 'true') === 'true',
      },
      workers: {
        generateResponse: readNumber(
          env,
          'QUEUE_WORKERS_GENERATE_RESPONSE',
          defaults.queue.workers.generateResponse
        ),
        indexMessageSearch: readNumber(
          env,
          'QUEUE_WORKERS_INDEX_MESSAGE_SEARCH',
          defaults.queue.workers.indexMessageSearch
        ),
        generateEmbeddings: readNumber(
          env,
          'QUEUE_WORKERS_GENERATE_EMBEDDINGS',
          defaults.queue.workers.generateEmbeddings
        ),
        processFile: readNumber(env, 'QUEUE_WORKERS_PROCESS_FILE', defaults.queue.workers.processFile),
        cleanup: readNumber(env, 'QUEUE_WORKERS_CLEANUP', defaults.queue.workers.cleanup),
        notification: readNumber(env, 'QUEUE_WORKERS_NOTIFICATION', defaults.queue.workers.notification),
      },
      retry: {
        attempts: readNumber(env, 'QUEUE_RETRY_ATTEMPTS', defaults.queue.retry.attempts),
        backoffMs: readNumber(env, 'QUEUE_RETRY_BACKOFF_MS', defaults.queue.retry.backoffMs),
        backoffStrategy: readString(
          env,
          'QUEUE_RETRY_BACKOFF_STRATEGY',
          defaults.queue.retry.backoffStrategy
        ) as AppConfig['queue']['retry']['backoffStrategy'],
      },
      deadLetter: {
        enabled: readString(env, 'QUEUE_DEAD_LETTER_ENABLED', String(defaults.queue.deadLetter.enabled)) === 'true',
        retention: readNumber(env, 'QUEUE_DEAD_LETTER_RETENTION_MS', defaults.queue.deadLetter.retention),
      },
      rateLimit: {
        enabled: readString(env, 'QUEUE_RATE_LIMIT_ENABLED', String(defaults.queue.rateLimit.enabled)) === 'true',
        maxJobsPerSecond: readNumber(
          env,
          'QUEUE_RATE_LIMIT_MAX_JOBS_PER_SECOND',
          defaults.queue.rateLimit.maxJobsPerSecond
        ),
      },
    },
  };

  const result = AppConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }

  return result.data;
}
