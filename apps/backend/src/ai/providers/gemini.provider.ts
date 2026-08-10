import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
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
 * Google Gemini. Activated by setting `GOOGLE_AI_API_KEY`. Model is
 * `GEMINI_MODEL` (config: `ai.geminiModel`), defaulting to `gemini-1.5-pro`.
 */
export class GeminiTextProvider implements TextGenerationProvider {
  readonly id = 'gemini';
  readonly capabilities: readonly AICapability[] = ['text-generation', 'code-generation'];

  constructor(
    private readonly client: GoogleGenerativeAI,
    private readonly defaultModel: string
  ) {}

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const modelName = request.model ?? this.defaultModel;
    const systemInstruction = resolveSystemPrompt(request);

    try {
      const model: GenerativeModel = this.client.getGenerativeModel({
        model: modelName,
        systemInstruction,
      });

      const result = await model.generateContent({
        contents: resolveConversationTurns(request).map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        })),
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature,
        },
      });

      const usage = result.response.usageMetadata;

      return {
        text: result.response.text(),
        provider: this.id,
        model: modelName,
        usage: {
          inputTokens: usage?.promptTokenCount,
          outputTokens: usage?.candidatesTokenCount,
        },
        finishReason: result.response.candidates?.[0]?.finishReason,
      };
    } catch (error) {
      throw new AIProviderError(
        `Gemini text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const geminiDescriptor: AIProviderDescriptor = {
  id: 'gemini',
  displayName: 'Google Gemini',
  capabilities: ['text-generation', 'code-generation'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('GOOGLE_AI_API_KEY', 'ai:gemini');
  },
  async create() {
    const apiKey = await secretsManager.get('GOOGLE_AI_API_KEY', 'ai:gemini');
    return new GeminiTextProvider(new GoogleGenerativeAI(apiKey), getConfig().ai.geminiModel);
  },
};
