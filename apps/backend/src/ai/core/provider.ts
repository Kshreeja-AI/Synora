/**
 * Provider abstraction — all AI providers implement this interface.
 * No provider-specific logic may exist outside this layer.
 */

import {
  AIRequest,
  AIResponse,
  AIStreamEvent,
  AIModel,
  ProviderHealth,
  CancellationToken,
  AIError,
  ContextWindowExceededError,
} from './types';

export interface IProvider {
  readonly id: string;
  readonly name: string;

  initialize(): Promise<void>;

  listModels(): Promise<AIModel[]>;

  getModel(modelId: string): Promise<AIModel>;

  complete(request: AIRequest, cancellation?: CancellationToken): Promise<AIResponse>;

  stream(request: AIRequest, cancellation?: CancellationToken): AsyncIterable<AIStreamEvent>;

  getHealth(): Promise<ProviderHealth>;

  validateRequest(request: AIRequest): AIError | null;

  estimateTokens(text: string, modelId: string): Promise<number>;
}

export abstract class BaseProvider implements IProvider {
  protected models: AIModel[] = [];
  protected health: ProviderHealth;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly logger: any
  ) {
    this.health = {
      providerId: id,
      status: 'healthy',
      lastChecked: new Date(),
      errorRate: 0,
      avgLatencyMs: 0,
      consecutiveFailures: 0,
    };
  }

  abstract initialize(): Promise<void>;

  abstract listModels(): Promise<AIModel[]>;

  async getModel(modelId: string): Promise<AIModel> {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found in provider ${this.id}`);
    }
    return model;
  }

  abstract complete(request: AIRequest, cancellation?: CancellationToken): Promise<AIResponse>;

  abstract stream(request: AIRequest, cancellation?: CancellationToken): AsyncIterable<AIStreamEvent>;

  async getHealth(): Promise<ProviderHealth> {
    return { ...this.health };
  }

  abstract estimateTokens(text: string, modelId: string): Promise<number>;

  validateRequest(request: AIRequest): AIError | null {
    // Check model exists
    const model = this.models.find(m => m.id === request.model);
    if (!model) {
      return new AIError(`Model ${request.model} not found`, 'MODEL_NOT_FOUND', this.id, 404, false);
    }

    // Check context window
    const estimatedTokens = request.messages
      .reduce((sum, msg) => sum + (typeof msg.content === 'string' ? msg.content.length / 4 : 0), 0)
      + (request.systemPrompt?.length ?? 0) / 4;

    if (estimatedTokens > model.contextWindow) {
      return new ContextWindowExceededError(request.model, Math.ceil(estimatedTokens), model.contextWindow);
    }

    // Check max tokens
    if (request.maxTokens && request.maxTokens > (model.maxOutputTokens ?? 4096)) {
      return new AIError(
        `Max tokens ${request.maxTokens} exceeds model limit ${model.maxOutputTokens}`,
        'MAX_TOKENS_EXCEEDED',
        this.id,
        400,
        false
      );
    }

    return null;
  }

  protected recordSuccess(latencyMs: number): void {
    this.health.consecutiveFailures = 0;
    this.health.status = 'healthy';
    this.health.avgLatencyMs = (this.health.avgLatencyMs * 0.9) + (latencyMs * 0.1);
    this.health.lastChecked = new Date();
  }

  protected recordFailure(error: AIError): void {
    this.health.consecutiveFailures++;
    this.health.lastError = error.message;
    this.health.errorRate = Math.min(this.health.errorRate + 0.1, 1.0);

    if (this.health.consecutiveFailures > 5) {
      this.health.status = 'unhealthy';
    } else if (this.health.errorRate > 0.5) {
      this.health.status = 'degraded';
    }

    this.health.lastChecked = new Date();
  }

  protected recordHealthCheck(status: 'healthy' | 'degraded' | 'unhealthy'): void {
    if (status === 'healthy') {
      this.health.errorRate = Math.max(this.health.errorRate - 0.05, 0);
      this.health.consecutiveFailures = 0;
    }
    this.health.status = status;
    this.health.lastChecked = new Date();
  }
}

export interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderFactory {
  create(config: ProviderConfig, logger?: any): Promise<IProvider>;
}
