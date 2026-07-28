import { z } from 'zod';

export const DeploymentStageSchema = z.enum(['development', 'testing', 'qa', 'staging', 'production']);

export const OperatingModeSchema = z.enum(['offline', 'mock', 'enterprise', 'government', 'self-hosted']);

export const OperatingModeFlagsSchema = z.object({
  offline: z.boolean(),
  mock: z.boolean(),
  enterprise: z.boolean(),
  government: z.boolean(),
  selfHosted: z.boolean(),
});

/**
 * The full, validated, typed application configuration. Every field here
 * is either a plain env-derived value (validated with a real constraint,
 * not just "is a string") or a boolean/enum derived from stage+mode
 * detection — nothing in this shape is a raw URL/credential/provider name
 * hardcoded in application code.
 */
export const AppConfigSchema = z.object({
  stage: DeploymentStageSchema,
  modes: OperatingModeFlagsSchema,

  server: z.object({
    port: z.number().int().positive(),
    corsOrigins: z.array(z.string().url()).min(1),
  }),

  rateLimit: z.object({
    windowMs: z.number().int().positive(),
    maxRequests: z.number().int().positive(),
  }),

  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']),
  }),

  auth: z.object({
    jwtExpiry: z.string().min(1),
    jwtRefreshExpiry: z.string().min(1),
    jwtRefreshExpiryRememberMe: z.string().min(1),
    maxFailedLoginAttempts: z.number().int().positive(),
    lockoutDurationMinutes: z.number().int().positive(),
    passwordResetTokenExpiry: z.string().min(1),
    emailVerificationTokenExpiry: z.string().min(1),
  }),

  urls: z.object({
    backendUrl: z.string().url(),
    frontendUrl: z.string().url(),
  }),

  database: z.object({
    url: z.string().min(1),
  }),

  /**
   * Presence flags only — real key material stays inside SecretsManager.
   * This tells the rest of the app whether a given integration is usable
   * without ever handing out the credential itself.
   */
  providers: z.object({
    openaiEnabled: z.boolean(),
    anthropicEnabled: z.boolean(),
    replicateEnabled: z.boolean(),
  }),

  /**
   * Non-secret settings for the provider-agnostic AI abstraction
   * (src/ai/**). API keys themselves are never here — they stay in
   * SecretsManager and are read directly by each provider's descriptor in
   * src/ai/providers/*. `provider` is the one explicit selection switch;
   * everything else is a per-provider default that's only consulted if that
   * provider is the one actually selected/configured.
   */
  ai: z.object({
    /** Explicit override, e.g. "anthropic" | "openai" | "ollama" | ... */
    provider: z.string().optional(),
    anthropicModel: z.string().min(1),
    openaiModel: z.string().min(1),
    geminiModel: z.string().min(1),
    xaiModel: z.string().min(1),
    openrouterModel: z.string().min(1),
    deepseekModel: z.string().min(1),
    togetherModel: z.string().min(1),
    azureOpenAIEndpoint: z.string().optional(),
    azureOpenAIDeployment: z.string().optional(),
    azureOpenAIApiVersion: z.string().min(1),
    bedrockRegion: z.string().min(1).optional(),
    bedrockModelId: z.string().min(1),
    ollamaBaseUrl: z.string().optional(),
    ollamaModel: z.string().min(1),
  }),

  /**
   * Provider-agnostic mailer (src/mail/**). `transport` is the one explicit
   * selection switch, mirroring `ai.provider` — real SMTP credentials never
   * live here, only in SecretsManager (SMTP_USER / SMTP_PASSWORD), read
   * directly by src/mail/transports/smtp.transport.ts.
   */
  mail: z.object({
    transport: z.enum(['console', 'smtp']),
    fromAddress: z.string().email(),
    fromName: z.string().min(1),
    smtpHost: z.string().optional(),
    smtpPort: z.number().int().positive(),
    smtpSecure: z.boolean(),
  }),

  /**
   * Provider-agnostic file storage (src/storage/**), used today for avatar
   * uploads. `provider` is the one explicit selection switch, mirroring
   * `ai.provider` / `mail.transport` — adding an S3-compatible provider
   * later is a new descriptor, never a call-site change.
   */
  storage: z.object({
    provider: z.enum(['local']),
    localDirectory: z.string().min(1),
    publicBasePath: z.string().min(1),
    maxUploadBytes: z.number().int().positive(),
    maxAssetUploadBytes: z.number().int().positive(),
  }),

  billing: z.object({
    provider: z.enum(['stripe']).default('stripe'),
    defaultCurrency: z.string().min(1).default('USD'),
    trialDays: z.number().int().nonnegative().default(14),
  }),
});
