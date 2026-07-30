/**
 * AI Orchestrator — main service coordinating all AI operations.
 * Implements provider selection, failover, retry, rate limiting, and cost tracking.
 */

import {
  AIRequest,
  AIResponse,
  AIStreamEvent,
  AIError,
  CancellationToken,
  ProviderUnavailableError,
  RateLimitError,
  UsageMetrics,
  RetryPolicy,
} from './types';
import { IProvider } from './provider';
import { ProviderRegistry, ModelRegistry } from './registry';
import { ProviderResolver, ResolverConfig } from './resolver';
import { HealthMonitor, RateLimiter, WorkspaceQuotaManager } from './health';
import { HookEngine, ContextBuilder } from './hooks';
import { StreamManager } from './streaming';

export interface OrchestratorConfig {
  resolver?: ResolverConfig;
  defaultRetryPolicy?: RetryPolicy;
  enableMetrics?: boolean;
  enableTracing?: boolean;
}

export class AIOrchestrator {
  private providerRegistry: ProviderRegistry;
  private modelRegistry: ModelRegistry;
  private resolver: ProviderResolver;
  private healthMonitor: HealthMonitor;
  private rateLimiter: RateLimiter;
  private quotaManager: WorkspaceQuotaManager;
  private hookEngine: HookEngine;
  private contextBuilder: ContextBuilder;
  private streamManager: StreamManager;
  private metricsCollector: MetricsCollector;
  private readonly config: OrchestratorConfig;
  private readonly logger: any;

  private defaultRetryPolicy: RetryPolicy = {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    maxBackoffMs: 30000,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  };

  constructor(
    providers: Map<string, IProvider>,
    config: OrchestratorConfig = {},
    logger: any
  ) {
    this.config = config;
    this.logger = logger;

    this.providerRegistry = new ProviderRegistry();
    this.modelRegistry = new ModelRegistry();
    this.resolver = new ProviderResolver(this.providerRegistry, this.modelRegistry, config.resolver);
    this.healthMonitor = new HealthMonitor(providers);
    this.rateLimiter = new RateLimiter(60000, 100);
    this.quotaManager = new WorkspaceQuotaManager();
    this.hookEngine = new HookEngine(logger);
    this.contextBuilder = new ContextBuilder(logger);
    this.streamManager = new StreamManager();
    this.metricsCollector = new MetricsCollector();

    // Register providers
    for (const [providerId, provider] of providers.entries()) {
      this.providerRegistry.register(provider);
      this.healthMonitor.registerProvider(providerId);
    }

    if (config.defaultRetryPolicy) {
      this.defaultRetryPolicy = config.defaultRetryPolicy;
    }
  }

  async complete(request: AIRequest, cancellation?: CancellationToken): Promise<AIResponse> {
    const startTime = Date.now();
    const requestId: string = request.id || `req-${Date.now()}`;

    try {
      // 1. Pre-request hooks
      await this.hookEngine.beforeRequest(request);

      // 2. Resolve model and provider
      const model = await this.resolver.resolveModel(request);
      const provider = await this.resolver.resolveProvider(model.id);

      // 3. Check rate limits and quotas
      if (!this.rateLimiter.canMakeRequest(provider.id)) {
        const waitTime = this.rateLimiter.getWaitTimeMs(provider.id);
        throw new RateLimitError(provider.id, waitTime);
      }

      if (!this.quotaManager.canUseQuota(request.workspaceId, 1000)) {
        throw new AIError(
          'Workspace quota exceeded',
          'QUOTA_EXCEEDED',
          provider.id,
          429,
          true
        );
      }

      // 4. Validate request
      const validationError = provider.validateRequest(request);
      if (validationError) {
        throw validationError;
      }

      // 5. Execute with retry
      const response = await this.executeWithRetry(
        request,
        provider,
        this.config.defaultRetryPolicy ?? this.defaultRetryPolicy,
        cancellation
      );

      // 6. Post-request hooks
      await this.hookEngine.afterRequest(request, response);

      // 7. Record usage
      this.metricsCollector.recordUsage({
        requestId,
        workspaceId: request.workspaceId,
        providerId: provider.id,
        modelId: model.id,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costCents: response.cost,
        latencyMs: response.latencyMs,
        success: true,
        timestamp: new Date(),
      });

      this.quotaManager.consumeQuota(request.workspaceId, response.inputTokens + response.outputTokens);

      return response;
    } catch (error) {
      const aiError = error instanceof AIError ? error : new AIError(
        error instanceof Error ? error.message : String(error),
        'UNKNOWN_ERROR',
        undefined,
        500,
        false
      );

      await this.hookEngine.onError(request, aiError);

      this.metricsCollector.recordUsage({
        requestId,
        workspaceId: request.workspaceId,
        providerId: aiError.providerId || 'unknown',
        modelId: request.model,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: Date.now() - startTime,
        success: false,
        errorCode: aiError.code,
        timestamp: new Date(),
      });

      throw aiError;
    }
  }

  async *stream(request: AIRequest, cancellation?: CancellationToken): AsyncIterable<AIStreamEvent> {
    const requestId = request.id;

    try {
      await this.hookEngine.beforeRequest(request);

      const model = await this.resolver.resolveModel(request);
      const provider = await this.resolver.resolveProvider(model.id);

      if (!this.rateLimiter.canMakeRequest(provider.id)) {
        throw new RateLimitError(provider.id);
      }

      await this.hookEngine.onStreamStart(request);

      let eventCount = 0;
      for await (const event of this.streamManager.createStream(
        requestId,
        provider.stream(request, cancellation),
        cancellation
      )) {
        eventCount++;
        yield event;
      }

      await this.hookEngine.onStreamEnd(request, eventCount);
    } catch (error) {
      const aiError = error instanceof AIError ? error : new AIError(
        error instanceof Error ? error.message : String(error),
        'STREAM_ERROR',
        undefined,
        500,
        true
      );

      await this.hookEngine.onError(request, aiError);
      throw aiError;
    }
  }

  private async executeWithRetry(
    request: AIRequest,
    provider: IProvider,
    policy: RetryPolicy,
    cancellation?: CancellationToken
  ): Promise<AIResponse> {
    let lastError: AIError | null = null;
    let backoffMs = policy.backoffMs;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        if (cancellation?.isCancelled) {
          throw new AIError('Request cancelled', 'CANCELLED', provider.id, 0, false);
        }

        const response = await provider.complete(request, cancellation);
        this.healthMonitor.recordRequest(provider.id, true, response.latencyMs);
        return response;
      } catch (error) {
        const aiError = error instanceof AIError ? error : new AIError(
          error instanceof Error ? error.message : String(error),
          'REQUEST_FAILED',
          provider.id,
          undefined,
          true
        );

        lastError = aiError;

        this.healthMonitor.recordRequest(provider.id, false, 0, aiError);

        if (attempt < policy.maxAttempts && aiError.retryable) {
          this.logger.debug(`Retry attempt ${attempt}/${policy.maxAttempts} for provider ${provider.id}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs = Math.min(backoffMs * policy.backoffMultiplier, policy.maxBackoffMs);
        } else {
          throw aiError;
        }
      }
    }

    throw lastError ?? new AIError('Max retries exceeded', 'MAX_RETRIES_EXCEEDED', provider.id, 500, false);
  }

  registerHook(hookType: string, hook: Function): void {
    this.hookEngine.register(hookType, hook as any);
  }

  setMemoryProvider(provider: any): void {
    this.contextBuilder.setMemoryProvider(provider);
  }

  setSearchProvider(provider: any): void {
    this.contextBuilder.setSearchProvider(provider);
  }

  setRAGProvider(provider: any): void {
    this.contextBuilder.setRAGProvider(provider);
  }

  getMetrics(): UsageMetrics[] {
    return this.metricsCollector.getMetrics();
  }

  getProviderHealth(providerId: string): any {
    return this.healthMonitor.getHealth(providerId);
  }

  shutdown(): void {
    this.healthMonitor.shutdown();
  }
}

class MetricsCollector {
  private metrics: UsageMetrics[] = [];
  private readonly maxMetrics = 10000;

  recordUsage(metric: UsageMetrics): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  getMetrics(): UsageMetrics[] {
    return [...this.metrics];
  }

  getMetricsByWorkspace(workspaceId: string): UsageMetrics[] {
    return this.metrics.filter(m => m.workspaceId === workspaceId);
  }

  getMetricsByProvider(providerId: string): UsageMetrics[] {
    return this.metrics.filter(m => m.providerId === providerId);
  }

  getTotalCost(): number {
    return this.metrics.reduce((sum, m) => sum + m.costCents, 0) / 100;
  }
}
