/**
 * Anthropic streaming provider implementation
 */

import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicStreamProvider implements TextGenerationStreamProvider {
  private client: Anthropic;
  private configured = false;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY
    });
    this.configured = !!this.client.apiKey;
  }

  getName(): string {
    return 'anthropic';
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      throw new StreamingError(
        'PROVIDER_NOT_CONFIGURED',
        'Anthropic provider not configured',
        false
      );
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      // Set up timeout (30 min default)
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError('Anthropic stream timeout'));
        }, 30 * 60 * 1000);
      });

      // Build messages
      const messages = input.messages.map(m => ({
        role: m.role === 'system' ? 'user' : (m.role as 'user' | 'assistant'),
        content: m.content
      }));

      // Create streaming message
      const stream = await Promise.race([
        this.client.messages.stream({
          model: input.model,
          max_tokens: input.maxTokens || 1024,
          messages,
          system: input.systemPrompt,
          temperature: input.temperature,
          top_p: input.topP,
          ...(input.frequencyPenalty && { frequency_penalty: input.frequencyPenalty }),
          ...(input.presencePenalty && { presence_penalty: input.presencePenalty })
        }),
        timeout
      ]);

      // Process stream
      for await (const event of stream) {
        // Check for abort signal
        if (input.abortSignal?.aborted) {
          logger.info('[AnthropicStream] Aborted by signal', { model: input.model });
          break;
        }

        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield {
              type: StreamChunkType.TOKEN,
              token: event.delta.text
            };
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            outputTokens = event.usage.output_tokens;
          }
        }
      }

      // Yield final usage
      yield {
        type: StreamChunkType.USAGE,
        inputTokens,
        outputTokens
      };
    } catch (error: any) {
      logger.error('[AnthropicStream] Error', { error: error.message });

      // Map Anthropic errors to streaming errors
      if (error instanceof TimeoutError) {
        throw error;
      }

      if (error.status === 429) {
        const retryAfter = parseInt(error.headers?.['retry-after'] || '60');
        throw new RateLimitError(retryAfter);
      }

      if (error.status === 401 || error.status === 403) {
        throw new StreamingError(
          'AUTHENTICATION_ERROR',
          'Anthropic authentication failed',
          false
        );
      }

      if (error.message?.includes('overloaded')) {
        throw new StreamingError('SERVICE_OVERLOADED', 'Anthropic service overloaded', true);
      }

      throw new StreamingError(
        'PROVIDER_ERROR',
        `Anthropic error: ${error.message}`,
        true
      );
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
