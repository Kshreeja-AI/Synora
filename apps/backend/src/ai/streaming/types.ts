/**
 * Streaming types and interfaces for provider-agnostic AI streaming
 */

// AbortSignal is a Node 20+ / DOM global — no polyfill needed on our
// runtime (Node 20+, see CLAUDE.md), so it's referenced directly here
// rather than importing the `abort-controller` polyfill package.

export enum StreamChunkType {
  TOKEN = 'token',
  USAGE = 'usage',
  ERROR = 'error',
  HEARTBEAT = 'heartbeat'
}

export interface StreamChunk {
  type: StreamChunkType;

  // For type='token'
  token?: string;

  // For type='usage' (final chunk)
  inputTokens?: number;
  outputTokens?: number;

  // For type='error'
  error?: {
    code: string;
    message: string;
    retryAfter?: number;
  };

  // For type='heartbeat'
  timestamp?: Date;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateStreamInput {
  messages: Message[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface TextGenerationStreamProvider {
  /**
   * Stream text generation from provider
   * Yields chunks as they arrive
   * Respects AbortSignal for cancellation
   */
  generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk>;

  /**
   * Get provider name
   */
  getName(): string;

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean;
}

export interface StreamingJobData {
  jobId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  provider: string;
  model: string;
}

export interface StreamingMetrics {
  inputTokens: number;
  outputTokens: number;
  estimatedCostCents: number;
  durationMs: number;
  chunksReceived: number;
  timeToFirstTokenMs: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class StreamingError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'StreamingError';
  }
}

export class ProviderNotConfiguredError extends StreamingError {
  constructor(provider: string) {
    super('PROVIDER_NOT_CONFIGURED', `Provider ${provider} is not configured`, false);
  }
}

export class ProviderNotFoundError extends StreamingError {
  constructor(provider: string) {
    super('PROVIDER_NOT_FOUND', `Provider ${provider} not found`, false);
  }
}

export class RateLimitError extends StreamingError {
  constructor(retryAfter: number = 60) {
    super('RATE_LIMIT_EXCEEDED', 'Provider rate limit exceeded', true, retryAfter);
  }
}

export class TimeoutError extends StreamingError {
  constructor(message: string = 'Generation timeout') {
    super('TIMEOUT', message, true);
  }
}
