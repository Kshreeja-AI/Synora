import Anthropic from '@anthropic-ai/sdk';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from '../types';
import { resolveSystemPrompt, DEFAULT_MAX_TOKENS } from '../shared';
import { AIProviderDescriptor } from '../registry';

/**
 * Release 1's default text/code generation provider. Activated purely by
 * setting `ANTHROPIC_API_KEY` — no code change. Model is
 * `ANTHROPIC_MODEL` (config: `ai.anthropicModel`), defaulting to
 * `claude-sonnet-5`.
 */
export class AnthropicTextProvider implements TextGenerationProvider {
  readonly id = 'anthropic';
  readonly capabilities: readonly AICapability[] = ['text-generation', 'code-generation'];

  constructor(
    private readonly client: Anthropic,
    private readonly defaultModel: string
  ) {}

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const model = request.model ?? this.defaultModel;

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        system: resolveSystemPrompt(request),
        messages: [{ role: 'user', content: request.prompt }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        provider: this.id,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
        finishReason: response.stop_reason ?? undefined,
      };
    } catch (error) {
      throw new AIProviderError(
        `Anthropic text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const anthropicDescriptor: AIProviderDescriptor = {
  id: 'anthropic',
  displayName: 'Anthropic Claude',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return (await secretsManager.tryGet('ANTHROPIC_API_KEY', 'ai:anthropic')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('ANTHROPIC_API_KEY', 'ai:anthropic');
    return new AnthropicTextProvider(new Anthropic({ apiKey }), getConfig().ai.anthropicModel);
  },
};
