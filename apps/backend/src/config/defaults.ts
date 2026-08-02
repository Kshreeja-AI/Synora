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
    jwtRefreshExpiryRememberMe: string;
    maxFailedLoginAttempts: number;
    lockoutDurationMinutes: number;
    passwordResetTokenExpiry: string;
    emailVerificationTokenExpiry: string;
  };
  urls: {
    backendUrl: string;
    frontendUrl: string;
  };
  ai: {
    anthropicModel: string;
    openaiModel: string;
    openaiImageModel: string;
    openaiTtsModel: string;
    openaiTtsVoice: string;
    geminiModel: string;
    xaiModel: string;
    openrouterModel: string;
    deepseekModel: string;
    togetherModel: string;
    azureOpenAIApiVersion: string;
    bedrockModelId: string;
    ollamaModel: string;
  };
  mail: {
    transport: 'console' | 'smtp';
    fromAddress: string;
    fromName: string;
    smtpPort: number;
    smtpSecure: boolean;
  };
  storage: {
    provider: 'local';
    localDirectory: string;
    publicBasePath: string;
    maxUploadBytes: number;
    maxAssetUploadBytes: number;
  };
  virusScan: {
    provider: 'none' | 'clamav';
    clamavPort: number;
    clamavTimeoutMs: number;
    maxScanBytes: number;
    forceBlockUnscanned: boolean;
  };
  billing: {
    provider: 'stripe';
    defaultCurrency: string;
    trialDays: number;
  };
  queue: {
    enabled: boolean;
    workers: {
      generateResponse: number;
      indexMessageSearch: number;
      generateEmbeddings: number;
      processFile: number;
      cleanup: number;
      notification: number;
    };
    retry: {
      attempts: number;
      backoffMs: number;
      backoffStrategy: 'exponential' | 'fixed';
    };
    deadLetter: {
      enabled: boolean;
      retention: number;
    };
    rateLimit: {
      enabled: boolean;
      maxJobsPerSecond: number;
    };
  };
  embeddings: {
    enabled: boolean;
    openaiModel: string;
    geminiModel: string;
    voyageModel: string;
    cohereModel: string;
    ollamaModel: string;
    selfHostedModel: string;
    cache: {
      backend: 'memory' | 'redis';
      maxEntries: number;
      ttlMs: number;
    };
    rateLimit: {
      backend: 'memory' | 'redis';
      requestsPerSecond: number;
    };
    retry: {
      attempts: number;
      backoffMs: number;
      backoffStrategy: 'exponential' | 'fixed';
    };
    circuitBreaker: {
      failureThreshold: number;
      cooldownMs: number;
      halfOpenSuccessThreshold: number;
    };
    security: {
      maxInputChars: number;
      maxBatchRequestSize: number;
    };
    chunking: {
      defaultChunkSize: number;
      defaultOverlap: number;
    };
  };
  vectordb: {
    enabled: boolean;
    pgvectorEnabled: boolean;
    pgvectorDimensions: number;
    security: {
      maxUpsertRequestSize: number;
      maxTopK: number;
      maxDimensions: number;
    };
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
    jwtRefreshExpiryRememberMe: '30d',
    maxFailedLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    passwordResetTokenExpiry: '1h',
    emailVerificationTokenExpiry: '24h',
  },
  urls: {
    backendUrl: 'http://localhost:3001',
    frontendUrl: 'http://localhost:3000',
  },
  ai: {
    // Sensible general-purpose defaults, each overridable by its own env
    // var without a code change — see docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md.
    anthropicModel: 'claude-sonnet-5',
    openaiModel: 'gpt-4o',
    openaiImageModel: 'gpt-image-1',
    openaiTtsModel: 'tts-1',
    openaiTtsVoice: 'alloy',
    geminiModel: 'gemini-1.5-pro',
    xaiModel: 'grok-2-latest',
    openrouterModel: 'anthropic/claude-3.5-sonnet',
    deepseekModel: 'deepseek-chat',
    togetherModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    azureOpenAIApiVersion: '2024-10-21',
    bedrockModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    ollamaModel: 'llama3.1',
  },
  mail: {
    // Console until MAIL_TRANSPORT explicitly selects a real provider — see
    // src/mail/registry.ts. Never auto-upgrades based on credential presence.
    transport: 'console',
    fromAddress: 'noreply@synora.ai',
    fromName: 'Synora',
    smtpPort: 587,
    smtpSecure: false,
  },
  storage: {
    provider: 'local',
    localDirectory: 'uploads',
    publicBasePath: '/uploads',
    maxUploadBytes: 5 * 1024 * 1024, // 5 MiB — plenty for an avatar image
    maxAssetUploadBytes: 25 * 1024 * 1024, // 25 MiB — workspace assets (docs, images, etc.), not just avatars
  },
  virusScan: {
    provider: 'none', // no scanner until a clamd host is configured
    clamavPort: 3310,
    clamavTimeoutMs: 30000,
    maxScanBytes: 25 * 1024 * 1024, // 25 MiB — matches the largest upload limit above
    forceBlockUnscanned: false, // production is fail-closed regardless; this hardens other stages
  },
  billing: {
    provider: 'stripe',
    defaultCurrency: 'USD',
    trialDays: 14,
  },
  queue: {
    enabled: true,
    workers: {
      generateResponse: 5,
      indexMessageSearch: 2,
      generateEmbeddings: 2,
      processFile: 3,
      cleanup: 1,
      notification: 2,
    },
    retry: {
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    },
    deadLetter: {
      enabled: true,
      retention: 86400000, // 24 hours
    },
    rateLimit: {
      enabled: true,
      maxJobsPerSecond: 100,
    },
  },
  embeddings: {
    enabled: true,
    openaiModel: 'text-embedding-3-small',
    geminiModel: 'text-embedding-004',
    voyageModel: 'voyage-3',
    cohereModel: 'embed-english-v3.0',
    ollamaModel: 'nomic-embed-text',
    selfHostedModel: 'nomic-embed-text',
    cache: {
      backend: 'memory',
      maxEntries: 10_000,
      ttlMs: 86_400_000, // 24 hours — embeddings are deterministic per (provider, model, text)
    },
    rateLimit: {
      backend: 'memory',
      requestsPerSecond: 50,
    },
    retry: {
      attempts: 3,
      backoffMs: 500,
      backoffStrategy: 'exponential',
    },
    circuitBreaker: {
      failureThreshold: 5,
      cooldownMs: 30_000,
      halfOpenSuccessThreshold: 2,
    },
    security: {
      maxInputChars: 50_000,
      maxBatchRequestSize: 1000,
    },
    chunking: {
      defaultChunkSize: 1000,
      defaultOverlap: 100,
    },
  },
  vectordb: {
    enabled: true,
    pgvectorEnabled: false,
    pgvectorDimensions: 1536,
    security: {
      maxUpsertRequestSize: 1000,
      maxTopK: 1000,
      maxDimensions: 4096,
    },
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
    ai: { ...BASE_DEFAULTS.ai, ...override.ai },
    mail: { ...BASE_DEFAULTS.mail, ...override.mail },
    storage: { ...BASE_DEFAULTS.storage, ...override.storage },
    virusScan: { ...BASE_DEFAULTS.virusScan, ...override.virusScan },
    billing: { ...BASE_DEFAULTS.billing, ...override.billing },
    queue: { ...BASE_DEFAULTS.queue, ...override.queue },
    embeddings: { ...BASE_DEFAULTS.embeddings, ...override.embeddings },
    vectordb: { ...BASE_DEFAULTS.vectordb, ...override.vectordb },
  };

  return applyModeOverrides(merged, modes);
}
