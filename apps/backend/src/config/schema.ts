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
});
