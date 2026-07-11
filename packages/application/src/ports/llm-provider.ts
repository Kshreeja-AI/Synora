/** Port for LLM chat completion (default provider: OpenRouter — see infra-llm-openrouter). */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface LlmCompletionResult {
  readonly content: string;
  readonly model: string;
  readonly usage?: Readonly<{ promptTokens: number; completionTokens: number }>;
}

export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
