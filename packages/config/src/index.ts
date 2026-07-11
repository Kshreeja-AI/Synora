import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),

  EVENT_BUS_DRIVER: z.enum(['in-memory', 'redis']).default('in-memory'),
  REDIS_URL: z.string().optional(),

  VECTOR_STORE_DRIVER: z.enum(['in-memory', 'pgvector']).default('in-memory'),
  DATABASE_URL: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEFAULT_MODEL_PROVIDER: z.string().default('anthropic'),
  DEFAULT_MODEL: z.string().default('claude-sonnet-5'),

  EMBEDDING_PROVIDER: z.string().default('openai'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  API_KEYS: z.string().default(''),
  JWT_SIGNING_SECRET: z.string().default('change-me-in-production'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SERVICE_NAME: z.string().default('synora'),
});

export type SynoraConfig = z.infer<typeof EnvSchema>;

let cached: SynoraConfig | undefined;

/**
 * Parses and validates process.env once per process. Fails fast at
 * startup (not deep inside a request handler) if required variables
 * are missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SynoraConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test/tooling escape hatch — never call from app code. */
export function resetConfigCache(): void {
  cached = undefined;
}

export interface ParsedApiKey {
  keyId: string;
  secret: string;
  scopes: string[];
}

/** Parses the "keyId:secret:scope1|scope2,keyId2:secret2:scope1" API_KEYS format. */
export function parseApiKeys(raw: string): ParsedApiKey[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Scope names themselves contain colons (e.g. "memory:read"), so only
      // the first two colons delimit keyId/secret — everything after is scopes.
      const firstColon = entry.indexOf(':');
      const secondColon = entry.indexOf(':', firstColon + 1);
      if (firstColon === -1 || secondColon === -1) {
        throw new Error(`Malformed API_KEYS entry: "${entry}"`);
      }
      const keyId = entry.slice(0, firstColon);
      const secret = entry.slice(firstColon + 1, secondColon);
      const scopeStr = entry.slice(secondColon + 1);
      if (!keyId || !secret) {
        throw new Error(`Malformed API_KEYS entry: "${entry}"`);
      }
      return { keyId, secret, scopes: scopeStr ? scopeStr.split('|') : [] };
    });
}
