import { z } from 'zod';

const boolFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Mirrors .env.example — keep these two in sync when adding new configuration. */
export const configSchema = z.object({
  app: z.object({
    name: z.string().default('Synora'),
    env: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    version: z.string().default('0.1.0'),
    nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
    logLevel: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    defaultRegion: z.string().default('asia-south1'),
    timezone: z.string().default('UTC'),
  }),
  features: z.object({
    telemetry: boolFromEnv,
    analytics: boolFromEnv,
    experiments: boolFromEnv,
    cache: boolFromEnv,
    vectorMemory: boolFromEnv,
    eventBus: boolFromEnv,
    multiAgent: boolFromEnv,
    observability: boolFromEnv,
    workflows: boolFromEnv,
    pluginSystem: boolFromEnv,
    documentProcessing: boolFromEnv,
    webSearch: boolFromEnv,
    codeExecution: boolFromEnv,
    imageGeneration: boolFromEnv,
    videoGeneration: boolFromEnv,
    audioGeneration: boolFromEnv,
  }),
  providers: z.object({
    llm: z.string().default('openrouter'),
    embedding: z.string().default('openai-compatible'),
    vectorDatabase: z.string().default('qdrant'),
    database: z.string().default('postgres'),
    cache: z.string().default('redis'),
    objectStorage: z.string().default('s3-compatible'),
    eventBus: z.string().default('nats'),
    queue: z.string().default('redis'),
    search: z.string().default('tavily'),
    auth: z.string().default('better-auth'),
    payment: z.string().default('razorpay'),
    storage: z.string().default('s3'),
    secretManager: z.string().default('environment'),
    workflowEngine: z.string().default('temporal'),
    messageBus: z.string().default('nats'),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
