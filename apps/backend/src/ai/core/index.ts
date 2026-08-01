/**
 * AI Orchestration Runtime — Public API
 * Export only the domain contracts and orchestrator; infrastructure is internal.
 */

// Domain types
export {
  AIProvider,
  AIModel,
  ModelCapability,
  CapabilityMatrix,
  ProviderHealth,
  AIRequest,
  AIMessage,
  AIContent,
  ImageSource,
  AudioSource,
  AIResponse,
  AIStreamEvent,
  ToolDefinition,
  ToolCall,
  RetryPolicy,
  CancellationToken,
  AIError,
  ProviderUnavailableError,
  ModelNotFoundError,
  RateLimitError,
  ContextWindowExceededError,
  WorkspaceQuota,
  UsageMetrics,
  HookContext,
  Hook,
  HookRegistry,
} from './types';

// Provider interface
export {
  IProvider,
  BaseProvider,
  ProviderConfig,
  ProviderFactory,
} from './provider';

// Orchestrator (main entry point)
export {
  AIOrchestrator,
  OrchestratorConfig,
} from './orchestrator';

// Registries (for composition)
export {
  ProviderRegistry,
  ModelRegistry,
} from './registry';

// Resolver (for customization)
export {
  ProviderResolver,
  ResolverConfig,
} from './resolver';

// Health monitoring (for observability)
export {
  HealthMonitor,
  CircuitBreaker,
  RateLimiter,
  WorkspaceQuotaManager,
  HealthCheckConfig,
} from './health';

// Streaming (for streaming routes)
export {
  StreamManager,
  StreamContext,
  StreamStats,
  StreamBuffer,
  createStreamEventParser,
} from './streaming';

// Hooks (for extensibility)
export {
  HookEngine,
  ContextBuilder,
  MemoryProvider,
  SearchProvider,
  SearchResult,
  RAGProvider,
  Document,
} from './hooks';
