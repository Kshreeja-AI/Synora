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
    openaiImageModel: z.string().min(1),
    openaiTtsModel: z.string().min(1),
    openaiTtsVoice: z.string().min(1),
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
    /**
     * Synora's own outbound pacing toward text-generation vendors, keyed
     * per provider — the text-path twin of `embeddings.rateLimit`. `redis`
     * backend is required for multi-instance deployments (an in-memory
     * bucket per instance would jointly admit N x the intended rate).
     */
    rateLimit: z.object({
      backend: z.enum(['memory', 'redis']).default('memory'),
      requestsPerSecond: z.number().positive().default(10),
      redisUrl: z.string().url().optional(),
    }),
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

  /**
   * Malware scanning for uploaded files. `provider: 'none'` (the default)
   * means no scanner is configured — uploads are NOT marked clean, they are
   * recorded as unscanned, and whether they can be downloaded is governed by
   * the fail-closed policy below. Configuring `clamav` with a reachable clamd
   * host activates real scanning automatically. API keys aren't needed
   * (clamd is a network daemon), so all fields here are non-secret config.
   */
  virusScan: z.object({
    provider: z.enum(['none', 'clamav']).default('none'),
    clamavHost: z.string().optional(),
    clamavPort: z.number().int().positive().default(3310),
    clamavTimeoutMs: z.number().int().positive().default(30000),
    /** Files larger than this are not sent to the scanner (clamd's own limit). */
    maxScanBytes: z.number().int().positive().default(26214400), // 25 MiB
    /**
     * Force fail-closed everywhere: files that were not scanned clean
     * (no scanner configured, scan pending, or scan errored) cannot be
     * downloaded. Production is ALWAYS fail-closed regardless of this flag;
     * setting it true makes non-production stages fail-closed too. Infected
     * files are always blocked in every stage.
     */
    forceBlockUnscanned: z.boolean().default(false),
  }),

  billing: z.object({
    provider: z.enum(['stripe']).default('stripe'),
    defaultCurrency: z.string().min(1).default('USD'),
    trialDays: z.number().int().nonnegative().default(14),
  }),

  queue: z.object({
    enabled: z.boolean().default(true),
    redis: z.object({
      url: z.string().url().optional(),
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      password: z.string().optional(),
      db: z.number().int().nonnegative().optional(),
      tls: z.boolean().optional(),
      maxRetriesPerRequest: z.number().int().nonnegative().optional(),
      enableReadyCheck: z.boolean().default(true),
      enableOfflineQueue: z.boolean().default(true),
    }),
    workers: z.object({
      generateResponse: z.number().int().positive().default(5),
      indexMessageSearch: z.number().int().positive().default(2),
      generateEmbeddings: z.number().int().positive().default(2),
      processFile: z.number().int().positive().default(3),
      cleanup: z.number().int().positive().default(1),
      notification: z.number().int().positive().default(2),
    }),
    retry: z.object({
      attempts: z.number().int().positive().default(3),
      backoffMs: z.number().int().positive().default(1000),
      backoffStrategy: z.enum(['exponential', 'fixed']).default('exponential'),
    }),
    deadLetter: z.object({
      enabled: z.boolean().default(true),
      retention: z.number().int().positive().default(86400000),
    }),
    rateLimit: z.object({
      enabled: z.boolean().default(true),
      maxJobsPerSecond: z.number().positive().default(100),
    }),
  }),

  /**
   * Non-secret settings for the provider-agnostic embeddings abstraction
   * (`src/embeddings/`). API keys live in SecretsManager and are read
   * directly by each provider's descriptor in `src/embeddings/providers/*`.
   * `provider` is the one explicit selection switch, mirroring `ai.provider`
   * — everything else is a per-provider default or a cross-cutting
   * production concern (caching, rate limiting, retry, circuit breaking,
   * security limits) that applies regardless of which provider is active.
   */
  embeddings: z.object({
    enabled: z.boolean().default(true),
    provider: z.string().optional(),
    openaiModel: z.string().min(1).default('text-embedding-3-small'),
    geminiModel: z.string().min(1).default('text-embedding-004'),
    voyageModel: z.string().min(1).default('voyage-3'),
    cohereModel: z.string().min(1).default('embed-english-v3.0'),
    ollamaBaseUrl: z.string().url().optional(),
    ollamaModel: z.string().min(1).default('nomic-embed-text'),
    ollamaMaxBatchSize: z.number().int().positive().optional(),
    selfHostedBaseUrl: z.string().url().optional(),
    selfHostedApiKey: z.string().optional(),
    selfHostedModel: z.string().min(1).default('nomic-embed-text'),
    selfHostedMaxBatchSize: z.number().int().positive().optional(),

    cache: z.object({
      backend: z.enum(['memory', 'redis']).default('memory'),
      maxEntries: z.number().int().positive().default(10_000),
      ttlMs: z.number().int().positive().default(86_400_000),
      redisUrl: z.string().url().optional(),
    }),
    rateLimit: z.object({
      backend: z.enum(['memory', 'redis']).default('memory'),
      requestsPerSecond: z.number().positive().default(50),
      redisUrl: z.string().url().optional(),
    }),
    retry: z.object({
      attempts: z.number().int().positive().default(3),
      backoffMs: z.number().int().positive().default(500),
      backoffStrategy: z.enum(['exponential', 'fixed']).default('exponential'),
    }),
    circuitBreaker: z.object({
      failureThreshold: z.number().int().positive().default(5),
      cooldownMs: z.number().int().positive().default(30_000),
      halfOpenSuccessThreshold: z.number().int().positive().default(2),
    }),
    security: z.object({
      maxInputChars: z.number().int().positive().default(50_000),
      maxBatchRequestSize: z.number().int().positive().default(1000),
    }),
    chunking: z.object({
      defaultChunkSize: z.number().int().positive().default(1000),
      defaultOverlap: z.number().int().nonnegative().default(100),
    }),
  }),

  /**
   * Non-secret settings for the provider-agnostic vector database
   * abstraction (`src/vectordb/`). Connection secrets (API keys/tokens)
   * live in SecretsManager and are read directly by each provider's
   * descriptor in `src/vectordb/providers/*`. `provider` is the one
   * explicit selection switch, mirroring `ai.provider` / `embeddings.provider`.
   */
  vectordb: z.object({
    enabled: z.boolean().default(true),
    provider: z.string().optional(),
    pineconeHost: z.string().optional(),
    pineconeMaxUpsertBatchSize: z.number().int().positive().optional(),
    qdrantUrl: z.string().url().optional(),
    qdrantMaxUpsertBatchSize: z.number().int().positive().optional(),
    weaviateUrl: z.string().url().optional(),
    weaviateMaxUpsertBatchSize: z.number().int().positive().optional(),
    milvusUrl: z.string().url().optional(),
    milvusMaxUpsertBatchSize: z.number().int().positive().optional(),
    /**
     * Unlike every other provider here, pgvector reuses the application's
     * own PostgreSQL database rather than connecting to a separate one —
     * so it's always *reachable*, and needs its own explicit opt-in flag
     * rather than "is a connection secret present" to decide whether it's
     * "configured" for auto-detection purposes.
     */
    pgvectorEnabled: z.boolean().default(false),
    pgvectorDimensions: z.number().int().positive().default(1536),
    pgvectorMaxUpsertBatchSize: z.number().int().positive().optional(),

    security: z.object({
      maxUpsertRequestSize: z.number().int().positive().default(1000),
      maxTopK: z.number().int().positive().default(1000),
      maxDimensions: z.number().int().positive().default(4096),
    }),
  }),
});
