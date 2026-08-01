/**
 * Core AI Orchestration types — domain layer entities and value objects.
 * All AI interactions flow through these contracts; no provider-specific logic here.
 */

export interface AIProvider {
  id: string;
  name: string;
  type: 'chat' | 'completion' | 'embedding' | 'image' | 'audio' | 'multimodal';
  isAvailable: boolean;
  lastHealthCheck?: Date;
  metadata?: Record<string, unknown>;
}

export interface AIModel {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens?: number;
  trainingData?: string;
  releaseDate?: Date;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  capabilities: ModelCapability[];
  metadata?: Record<string, unknown>;
}

export type ModelCapability =
  | 'chat'
  | 'completion'
  | 'streaming'
  | 'vision'
  | 'audio-input'
  | 'audio-output'
  | 'tool-calling'
  | 'json-mode'
  | 'reasoning'
  | 'embeddings'
  | 'image-generation'
  | 'function-calling';

export interface CapabilityMatrix {
  [providerId: string]: {
    [modelId: string]: Set<ModelCapability>;
  };
}

export interface ProviderHealth {
  providerId: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unavailable';
  lastChecked: Date;
  errorRate: number;
  avgLatencyMs: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface AIRequest {
  id: string;
  workspaceId: string;
  conversationId?: string;
  userId: string;
  model: string;
  messages: AIMessage[];
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none' | string;
  responseFormat?: { type: 'json_object' | 'text' };
  stream?: boolean;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  fallbackModels?: string[];
  metadata?: Record<string, unknown>;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | AIContent[];
  toolCallId?: string;
  toolName?: string;
  name?: string;
}

export type AIContent =
  | { type: 'text'; text: string }
  | { type: 'image'; image: ImageSource }
  | { type: 'audio'; audio: AudioSource };

export interface ImageSource {
  url?: string;
  base64?: string;
  mediaType?: string;
  detail?: 'low' | 'high' | 'auto';
}

export interface AudioSource {
  url?: string;
  base64?: string;
  mediaType?: string;
}

export interface AIResponse {
  id: string;
  requestId: string;
  providerId: string;
  modelId: string;
  content: string;
  toolCalls: ToolCall[];
  stopReason: 'stop' | 'max_tokens' | 'tool_calls' | 'content_filter' | 'error';
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface AIStreamEvent {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'error';
  index?: number;
  delta?: {
    type: 'text_delta' | 'tool_use_delta' | 'tool_use_start';
    text?: string;
    toolUse?: Partial<ToolCall>;
  };
  message?: AIResponse;
  error?: AIError;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  retryableStatusCodes?: number[];
}

export interface CancellationToken {
  isCancelled: boolean;
  cancel(): void;
  onCancel(callback: () => void): void;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly providerId?: string,
    readonly statusCode?: number,
    readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'AIError';
  }
}

export class ProviderUnavailableError extends AIError {
  constructor(providerId: string, message?: string) {
    super(message || `Provider ${providerId} is unavailable`, 'PROVIDER_UNAVAILABLE', providerId, undefined, true);
    this.name = 'ProviderUnavailableError';
  }
}

export class ModelNotFoundError extends AIError {
  constructor(modelId: string) {
    super(`Model ${modelId} not found`, 'MODEL_NOT_FOUND', undefined, 404, false);
    this.name = 'ModelNotFoundError';
  }
}

export class RateLimitError extends AIError {
  constructor(providerId: string, retryAfterMs?: number) {
    super(`Rate limit exceeded for provider ${providerId}`, 'RATE_LIMIT_EXCEEDED', providerId, 429, true);
    this.retryAfterMs = retryAfterMs;
    this.name = 'RateLimitError';
  }

  retryAfterMs?: number;
}

export class ContextWindowExceededError extends AIError {
  constructor(modelId: string, required: number, available: number) {
    super(`Context window exceeded for model ${modelId}. Required: ${required}, Available: ${available}`,
      'CONTEXT_WINDOW_EXCEEDED', undefined, 400, false);
    this.name = 'ContextWindowExceededError';
  }
}

export interface WorkspaceQuota {
  workspaceId: string;
  monthlyBudgetCents: number;
  monthlySpentCents: number;
  dailyLimitRequests: number;
  dailyUsedRequests: number;
  requestsPerMinute: number;
  resetDate: Date;
}

export interface UsageMetrics {
  requestId: string;
  workspaceId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  timestamp: Date;
}

export interface HookContext {
  request: AIRequest;
  response?: AIResponse;
  error?: AIError;
  metadata?: Record<string, unknown>;
}

export type Hook = (context: HookContext) => Promise<void>;

export interface HookRegistry {
  onBeforeRequest: Hook[];
  onAfterRequest: Hook[];
  onError: Hook[];
  onStreamStart: Hook[];
  onStreamEnd: Hook[];
}
