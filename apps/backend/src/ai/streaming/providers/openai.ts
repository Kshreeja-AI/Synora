/**
 * OpenAI streaming provider implementation
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

export class OpenAIStreamProvider implements TextGenerationStreamProvider {
  private client: OpenAI;
  private configured = false;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY
    });
    this.configured = !!this.client.apiKey;
  }

  getName(): string {
    return 'openai';
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      throw new StreamingError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenAI provider not configured',
        false
      );
    }

    let outputTokens = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      // Set up timeout
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError('OpenAI stream timeout'));
        }, 30 * 60 * 1000);
      });

      // Build messages with system prompt
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (input.systemPrompt) {
        messages.push({
          role: 'system',
          content: input.systemPrompt
        });
      }
      messages.push(
        ...input.messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content
        }))
      );

      // Create stream
      const stream = await Promise.race([
        this.client.chat.completions.create({
          model: input.model,
          messages,
          max_tokens: input.maxTokens || 1024,
          temperature: input.temperature,
          top_p: input.topP,
          stream: true,
          frequency_penalty: input.frequencyPenalty,
          presence_penalty: input.presencePenalty
        }),
        timeout
      ]);

      // Process stream
      let inputTokens = 0;

      for await (const chunk of stream) {
        // Check for abort
        if (input.abortSignal?.aborted) {
          logger.info('[OpenAIStream] Aborted by signal', { model: input.model });
          break;
        }

        if (chunk.choices[0]?.delta?.content) {
          yield {
            type: StreamChunkType.TOKEN,
            token: chunk.choices[0].delta.content
          };
          outputTokens++;
        }

        // OpenAI sends usage info at the end
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      // Yield final usage
      yield {
        type: StreamChunkType.USAGE,
        inputTokens,
        outputTokens
      };
    } catch (error: any) {
      logger.error('[OpenAIStream] Error', { error: error.message });

      if (error instanceof TimeoutError) {
        throw error;
      }

      // Handle OpenAI-specific errors
      if (error.status === 429) {
        const retryAfter = parseInt(error.headers?.['retry-after'] || '60');
        throw new RateLimitError(retryAfter);
      }

      if (error.status === 401) {
        throw new StreamingError('INVALID_API_KEY', 'OpenAI API key invalid', false);
      }

      if (error.status === 403) {
        throw new StreamingError(
          'INSUFFICIENT_QUOTA',
          'OpenAI account quota exceeded',
          false
        );
      }

      if (error.code === 'ERR_INVALID_CHAR') {
        throw new StreamingError('MODEL_NOT_FOUND', 'Model not found', false);
      }

      throw new StreamingError('PROVIDER_ERROR', `OpenAI error: ${error.message}`, true);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
