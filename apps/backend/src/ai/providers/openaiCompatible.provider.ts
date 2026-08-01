import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from '../types';
import { resolveSystemPrompt, resolveConversationTurns, DEFAULT_MAX_TOKENS } from '../shared';
import type { AIProviderDescriptor } from '../types/descriptor';

/**
 * Generic adapter for any provider that exposes an OpenAI-compatible chat
 * completions endpoint (`POST /chat/completions`) — OpenAI itself, Together
 * AI, DeepSeek, OpenRouter, and xAI Grok all document exactly this
 * compatibility and are configured purely via a base URL + API key, with no
 * other request/response differences this application needs to handle. One
 * class, one set of tests; each provider's own file
 * (openai/together/deepseek/openrouter/xai) only supplies its id, base URL,
 * and default model.
 */
export class OpenAICompatibleTextProvider implements TextGenerationProvider {
  readonly capabilities: readonly AICapability[] = ['text-generation', 'code-generation'];

  constructor(
    readonly id: string,
    private readonly client: OpenAI,
    private readonly defaultModel: string
  ) {}

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const model = request.model ?? this.defaultModel;
    const systemPrompt = resolveSystemPrompt(request);

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          ...resolveConversationTurns(request).map((turn) => ({
            role: turn.role as 'user' | 'assistant',
            content: turn.content,
          })),
        ],
      });

      const choice = response.choices[0];

      return {
        text: choice?.message?.content ?? '',
        provider: this.id,
        model: response.model,
        usage: {
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        },
        finishReason: choice?.finish_reason ?? undefined,
      };
    } catch (error) {
      throw new AIProviderError(
        `${this.id} text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const openaiDescriptor: AIProviderDescriptor = {
  id: 'openai',
  displayName: 'OpenAI',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return (await secretsManager.tryGet('OPENAI_API_KEY', 'ai:openai')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('OPENAI_API_KEY', 'ai:openai');
    return new OpenAICompatibleTextProvider(
      'openai',
      new OpenAI({ apiKey }),
      getConfig().ai.openaiModel
    );
  },
};
