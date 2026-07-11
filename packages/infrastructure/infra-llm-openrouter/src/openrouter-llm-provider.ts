import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@synora/application';
import { InfrastructureError } from '@synora/errors';
import type { FetchLike } from './fetch-like.js';

export interface OpenRouterLlmProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

interface OpenRouterChatCompletionResponse {
  model: string;
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** LlmProvider adapter for DEFAULT_LLM_PROVIDER=openrouter, via OpenRouter's OpenAI-compatible chat-completions API. */
export class OpenRouterLlmProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: OpenRouterLlmProviderOptions) {
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.fetchFn = options.fetch ?? fetch;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new InfrastructureError(`OpenRouter request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OpenRouterChatCompletionResponse;
    const content = payload.choices[0]?.message.content ?? '';

    return {
      content,
      model: payload.model,
      ...(payload.usage
        ? {
            usage: {
              promptTokens: payload.usage.prompt_tokens,
              completionTokens: payload.usage.completion_tokens,
            },
          }
        : {}),
    };
  }
}
