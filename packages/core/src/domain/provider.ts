import type { Message } from './message.js';
import type { ToolDefinition } from './tool.js';

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerateOptions {
  model: string;
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { toolName: string };
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface GenerateResult {
  message: Message;
  finishReason: FinishReason;
  usage: ModelUsage;
  raw?: unknown;
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_delta'; toolCallId: string; toolName: string; inputJsonDelta: string }
  | { type: 'message_start' }
  | { type: 'message_stop'; finishReason: FinishReason; usage: ModelUsage }
  | { type: 'error'; error: Error };

export interface EmbeddingOptions {
  model: string;
  input: string[];
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: { inputTokens: number };
}

/**
 * The single interface every LLM vendor must satisfy to plug into
 * Synora. Orchestration, agents, and products depend only on this
 * port — never on a vendor SDK directly — so a new provider (or a
 * self-hosted model behind an OpenAI-compatible endpoint) is a new
 * adapter in packages/providers, not a change anywhere else.
 */
export interface ModelProvider {
  readonly id: string;
  readonly capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    embeddings: boolean;
  };

  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamEvent>;
  embed?(options: EmbeddingOptions): Promise<EmbeddingResult>;
}

export interface ModelProviderRegistry {
  register(provider: ModelProvider): void;
  get(providerId: string): ModelProvider;
  list(): ModelProvider[];
}
