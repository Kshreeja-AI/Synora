/**
 * OpenRouter streaming provider implementation
 */

import OpenAI from 'openai';
import { logger } from '../../../utils/logger';
import {
  TextGenerationStreamProvider,
  GenerateStreamInput,
  StreamChunk,
  StreamChunkType,
  TimeoutError,
  RateLimitError,
  StreamingError
} from '../types';

export class OpenRouterStreamProvider implements TextGenerationStreamProvider {
  private client: OpenAI;
  private configured = false;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    this.client = new OpenAI({
      apiKey: key,
      baseURL: 'https://openrouter.ai/api/v1'
    });
    this.configured = !!key;
  }

  getName(): string {
    return 'openrouter';
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      throw new StreamingError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenRouter provider not configured',
        false
      );
    }

    let outputTokens = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError('OpenRouter stream timeout'));
        }, 30 * 60 * 1000);
      });

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (input.systemPrompt) {
        messages.push({ role: 'system', content: input.systemPrompt });
      }
      messages.push(
        ...input.messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content
        }))
      );

      const stream = await Promise.race([
        this.client.chat.completions.create({
          model: input.model,
          messages,
          max_tokens: input.maxTokens || 1024,
          temperature: input.temperature,
          top_p: input.topP,
          stream: true
        }),
        timeout
      ]);

      let inputTokens = 0;

      for await (const chunk of stream) {
        if (input.abortSignal?.aborted) {
          logger.info('[OpenRouterStream] Aborted', { model: input.model });
          break;
        }

        if (chunk.choices[0]?.delta?.content) {
          yield {
            type: StreamChunkType.TOKEN,
            token: chunk.choices[0].delta.content
          };
          outputTokens++;
        }

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      yield {
        type: StreamChunkType.USAGE,
        inputTokens,
        outputTokens
      };
    } catch (error: any) {
      logger.error('[OpenRouterStream] Error', { error: error.message });

      if (error instanceof TimeoutError) throw error;
      if (error.status === 429) throw new RateLimitError();
      if (error.status === 401) throw new StreamingError('INVALID_API_KEY', 'OpenRouter key invalid', false);

      throw new StreamingError('PROVIDER_ERROR', `OpenRouter error: ${error.message}`, true);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
