import {
  CACHE,
  CLOCK,
  EMBEDDING_PROVIDER,
  ID_GENERATOR,
  LLM_PROVIDER,
  OBJECT_STORAGE,
  QUEUE,
  VECTOR_STORE,
} from '@synora/application';
import type { AppConfig } from '@synora/config';
import { Container } from '@synora/di';
import { InMemoryEventBus, type EventBus } from '@synora/event-bus';
import { createAwsS3Client, S3ObjectStorage } from '@synora/infra-storage-s3';
import {
  OpenAiCompatibleEmbeddingProvider,
  OpenRouterLlmProvider,
} from '@synora/infra-llm-openrouter';
import { createPostgresClient, POSTGRES_DATABASE } from '@synora/infra-postgres';
import { createQdrantClient, QdrantVectorStore } from '@synora/infra-qdrant';
import { createRedisClient, RedisCache, RedisQueue } from '@synora/infra-redis';
import type { Logger } from '@synora/logger';
import { CryptoIdGenerator } from './adapters/crypto-id-generator.js';
import { SystemClock } from './adapters/system-clock.js';

export interface CompositionRootOptions {
  config: AppConfig;
  logger: Logger;
}

export interface CompositionRoot {
  container: Container;
  eventBus: EventBus;
}

/**
 * The single place every concrete infra-* adapter gets bound to the application-layer
 * port it implements. Nothing outside this file imports both a port and its adapter —
 * see docs/architecture/04-dependency-injection.md.
 *
 * Scope note: AUTH_PROVIDER (better-auth) and WORKFLOW_ENGINE (Temporal) are not bound
 * here — both require a live external service (a configured better-auth instance, a
 * reachable Temporal server) that no current feature needs. The EventBus also defaults to
 * the in-memory adapter rather than NatsEventBus for the same reason: connecting eagerly
 * to infrastructure nothing yet uses would make every environment without that
 * infrastructure fail to boot. Wiring any of these for real is a small, additive change
 * once a feature needs them — see infra-nats, infra-auth-better-auth, and
 * infra-workflow-temporal for the adapters, already implemented and tested.
 *
 * Connection strings/secrets (DATABASE_URL, REDIS_URL, ...) are read directly from
 * process.env here rather than through AppConfig, since they aren't part of the
 * .env.example-mirrored application config schema — they're deployment-specific and
 * resolved via the default `environment` SecretManager backing store
 * (DEFAULT_SECRET_MANAGER=environment). Everything else must go through AppConfig.
 */
export function buildCompositionRoot(options: CompositionRootOptions): CompositionRoot {
  const { config, logger } = options;
  const container = new Container();
  const eventBus = new InMemoryEventBus({
    onHandlerError: (error, event) =>
      logger.error(`event handler for "${event.eventName}" threw`, { error }),
  });

  container.register(CLOCK, () => new SystemClock());
  container.register(ID_GENERATOR, () => new CryptoIdGenerator());

  const postgres = createPostgresClient({
    connectionString: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/synora',
  });
  container.registerValue(POSTGRES_DATABASE, postgres.db);

  const redis = createRedisClient({ url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' });
  container.register(CACHE, () => new RedisCache(redis));
  container.register(QUEUE, () => new RedisQueue(redis));

  const qdrant = createQdrantClient({ url: process.env['QDRANT_URL'] ?? 'http://localhost:6333' });
  container.register(VECTOR_STORE, () => new QdrantVectorStore(qdrant));

  container.register(
    LLM_PROVIDER,
    () => new OpenRouterLlmProvider({ apiKey: process.env['OPENROUTER_API_KEY'] ?? '' }),
  );
  container.register(
    EMBEDDING_PROVIDER,
    () =>
      new OpenAiCompatibleEmbeddingProvider({
        apiKey: process.env['OPENAI_API_KEY'] ?? '',
        baseUrl: process.env['EMBEDDING_BASE_URL'] ?? 'https://api.openai.com/v1',
        model: process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
      }),
  );

  container.register(
    OBJECT_STORAGE,
    () =>
      new S3ObjectStorage(
        createAwsS3Client({ region: process.env['AWS_REGION'] ?? config.app.defaultRegion }),
        process.env['S3_BUCKET'] ?? 'synora',
      ),
  );

  // AUTH_PROVIDER and WORKFLOW_ENGINE are intentionally left unbound here — see the doc comment above.

  return { container, eventBus };
}
