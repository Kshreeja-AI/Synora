import { config as loadDotenv } from 'dotenv';
import { type AppConfig, configSchema } from './schema.js';

export interface LoadConfigOptions {
  /** Raw source to read from — defaults to process.env. Overridable for tests. */
  env?: NodeJS.ProcessEnv;
  /** Whether to attempt loading a .env file first (default: true, no-ops if absent). */
  loadDotenvFile?: boolean;
}

/**
 * Reads and validates environment configuration once at process startup. Throws a
 * ValidationError-shaped zod error immediately if required configuration is missing or
 * malformed — fail fast rather than discovering it deep inside a request handler.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  if (options.loadDotenvFile !== false) {
    loadDotenv();
  }
  const env = options.env ?? process.env;

  const raw = {
    app: {
      name: env['APP_NAME'],
      env: env['APP_ENV'],
      version: env['APP_VERSION'],
      nodeEnv: env['NODE_ENV'],
      logLevel: env['LOG_LEVEL'],
      defaultRegion: env['DEFAULT_REGION'],
      timezone: env['TIMEZONE'],
    },
    features: {
      telemetry: env['ENABLE_TELEMETRY'],
      analytics: env['ENABLE_ANALYTICS'],
      experiments: env['ENABLE_EXPERIMENTS'],
      cache: env['ENABLE_CACHE'],
      vectorMemory: env['ENABLE_VECTOR_MEMORY'],
      eventBus: env['ENABLE_EVENT_BUS'],
      multiAgent: env['ENABLE_MULTI_AGENT'],
      observability: env['ENABLE_OBSERVABILITY'],
      workflows: env['ENABLE_WORKFLOWS'],
      pluginSystem: env['ENABLE_PLUGIN_SYSTEM'],
      documentProcessing: env['ENABLE_DOCUMENT_PROCESSING'],
      webSearch: env['ENABLE_WEB_SEARCH'],
      codeExecution: env['ENABLE_CODE_EXECUTION'],
      imageGeneration: env['ENABLE_IMAGE_GENERATION'],
      videoGeneration: env['ENABLE_VIDEO_GENERATION'],
      audioGeneration: env['ENABLE_AUDIO_GENERATION'],
    },
    providers: {
      llm: env['DEFAULT_LLM_PROVIDER'],
      embedding: env['DEFAULT_EMBEDDING_PROVIDER'],
      vectorDatabase: env['DEFAULT_VECTOR_DATABASE'],
      database: env['DEFAULT_DATABASE'],
      cache: env['DEFAULT_CACHE'],
      objectStorage: env['DEFAULT_OBJECT_STORAGE'],
      eventBus: env['DEFAULT_EVENT_BUS'],
      queue: env['DEFAULT_QUEUE'],
      search: env['DEFAULT_SEARCH_PROVIDER'],
      auth: env['DEFAULT_AUTH_PROVIDER'],
      payment: env['DEFAULT_PAYMENT_PROVIDER'],
      storage: env['DEFAULT_STORAGE_PROVIDER'],
      secretManager: env['DEFAULT_SECRET_MANAGER'],
      workflowEngine: env['DEFAULT_WORKFLOW_ENGINE'],
      messageBus: env['DEFAULT_MESSAGE_BUS'],
    },
  };

  return configSchema.parse(raw);
}
