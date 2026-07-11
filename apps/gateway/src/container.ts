import { type SynoraConfig, parseApiKeys } from '@synora/config';
import type {
  ConversationStore,
  EmbeddingProvider,
  EventBus,
  MemoryStore,
  ModelProviderRegistry,
  VectorStore,
  WorkflowDefinition,
} from '@synora/core';
import { createEventBus } from '@synora/event-bus';
import { InMemoryConversationStore, createMemoryStore, createVectorStore } from '@synora/memory';
import { InMemoryMetricsRecorder, createLogger, createTracer } from '@synora/observability';
import { AgentDefinitionRegistry, AgentRuntime, Orchestrator } from '@synora/orchestration';
import { OpenAiEmbeddingProvider, createDefaultProviderRegistry } from '@synora/providers';
import { ApiKeyAuthenticator, GuardrailRegistry, InMemoryRateLimiter } from '@synora/security';
import { ToolRegistry } from '@synora/tools';

const EMBEDDING_DIMENSIONS = 1536;

export interface PlatformContainer {
  config: SynoraConfig;
  logger: ReturnType<typeof createLogger>;
  tracer: ReturnType<typeof createTracer>;
  metrics: InMemoryMetricsRecorder;
  eventBus: EventBus;
  providerRegistry: ModelProviderRegistry;
  vectorStore: VectorStore;
  embeddingProvider?: EmbeddingProvider;
  memoryStore?: MemoryStore;
  conversationStore: ConversationStore;
  toolRegistry: ToolRegistry;
  guardrailRegistry: GuardrailRegistry;
  agentRegistry: AgentDefinitionRegistry;
  agentRuntime: AgentRuntime;
  orchestrator: Orchestrator;
  /** Workflow definitions available to POST /v1/workflows/:id/run; products register their own. */
  workflows: Map<string, WorkflowDefinition>;
  authenticator: ApiKeyAuthenticator;
  rateLimiter: InMemoryRateLimiter;
}

/**
 * Assembles every platform package into one dependency graph. This is
 * the platform's composition root: apps/gateway calls it directly to
 * run standalone; every product (apps/kshreeja-ai and future ones)
 * calls the exact same function and then layers its own agents/tools
 * on top of `agentRegistry`/`toolRegistry` — the platform itself never
 * changes to support a new product.
 */
export function buildPlatformContainer(config: SynoraConfig): PlatformContainer {
  const logger = createLogger({
    serviceName: config.SERVICE_NAME,
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });
  const tracer = createTracer(config.SERVICE_NAME);
  const metrics = new InMemoryMetricsRecorder();

  const eventBus = createEventBus(config.EVENT_BUS_DRIVER, { redisUrl: config.REDIS_URL, logger });

  const providerRegistry = createDefaultProviderRegistry({
    anthropicApiKey: config.ANTHROPIC_API_KEY,
    openaiApiKey: config.OPENAI_API_KEY,
  });

  const vectorStore = createVectorStore(config.VECTOR_STORE_DRIVER, {
    connectionString: config.DATABASE_URL,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const embeddingProvider = config.OPENAI_API_KEY
    ? new OpenAiEmbeddingProvider({
        apiKey: config.OPENAI_API_KEY,
        model: config.EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      })
    : undefined;
  if (!embeddingProvider) {
    logger.warn(
      'No OPENAI_API_KEY configured; long-term memory (write/search) is disabled for this process.',
    );
  }
  const memoryStore = embeddingProvider
    ? createMemoryStore(vectorStore, embeddingProvider)
    : undefined;

  const conversationStore = new InMemoryConversationStore();
  const toolRegistry = new ToolRegistry();
  const guardrailRegistry = new GuardrailRegistry();
  const agentRegistry = new AgentDefinitionRegistry();

  const agentRuntime = new AgentRuntime({
    providerRegistry,
    toolRegistry,
    conversationStore,
    memoryStore,
    eventBus,
    guardrails: guardrailRegistry,
    logger,
  });

  const orchestrator = new Orchestrator({ agentRuntime, agentRegistry, eventBus, toolRegistry });

  const authenticator = new ApiKeyAuthenticator(
    parseApiKeys(config.API_KEYS).map((k) => ({
      keyId: k.keyId,
      secret: k.secret,
      scopes: k.scopes as never,
    })),
  );
  const rateLimiter = new InMemoryRateLimiter(config.RATE_LIMIT_PER_MINUTE, 60_000);
  const workflows = new Map<string, WorkflowDefinition>();

  return {
    config,
    logger,
    tracer,
    metrics,
    eventBus,
    providerRegistry,
    vectorStore,
    embeddingProvider,
    memoryStore,
    conversationStore,
    toolRegistry,
    guardrailRegistry,
    agentRegistry,
    agentRuntime,
    orchestrator,
    workflows,
    authenticator,
    rateLimiter,
  };
}
