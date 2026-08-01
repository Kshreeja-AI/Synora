/**
 * Groq streaming provider implementation
 */

import Groq from 'groq-sdk';
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

export class GroqStreamProvider implements TextGenerationStreamProvider {
  private client: Groq;
  private configured = false;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GROQ_API_KEY;
    this.client = new Groq({ apiKey: key });
    this.configured = !!key;
  }

  getName(): string {
    return 'groq';
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      throw new StreamingError(
        'PROVIDER_NOT_CONFIGURED',
        'Groq provider not configured',
        false
      );
    }

    let outputTokens = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError('Groq stream timeout'));
        }, 30 * 60 * 1000);
      });

      const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
      if (input.systemPrompt) {
        messages.push({ role: 'system', content: input.systemPrompt });
      }
      messages.push(
        ...input.messages.map(m => ({
          role: m.role as 'user' | 'assistant',
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
          logger.info('[GroqStream] Aborted', { model: input.model });
          break;
        }

        if (chunk.choices[0]?.delta?.content) {
          yield {
            type: StreamChunkType.TOKEN,
            token: chunk.choices[0].delta.content
          };
          outputTokens++;
        }

        // groq-sdk's ChatCompletionChunk type doesn't declare `usage` (it's
        // only present on the final chunk when `stream_options.include_usage`
        // is requested, which this OpenAI-compatible API supports at runtime
        // but the SDK's stream chunk type doesn't model) — narrow locally
        // rather than widening the whole chunk to `any`.
        const usage = (chunk as unknown as { usage?: { prompt_tokens: number; completion_tokens: number } }).usage;
        if (usage) {
          inputTokens = usage.prompt_tokens;
          outputTokens = usage.completion_tokens;
        }
      }

      yield {
        type: StreamChunkType.USAGE,
        inputTokens,
        outputTokens
      };
    } catch (error: any) {
      logger.error('[GroqStream] Error', { error: error.message });

      if (error instanceof TimeoutError) throw error;
      if (error.status === 429) throw new RateLimitError();
      if (error.status === 401) throw new StreamingError('INVALID_API_KEY', 'Groq key invalid', false);

      throw new StreamingError('PROVIDER_ERROR', `Groq error: ${error.message}`, true);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
