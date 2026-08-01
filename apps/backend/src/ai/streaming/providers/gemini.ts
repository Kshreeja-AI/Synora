/**
 * Google Gemini streaming provider implementation
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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

export class GeminiStreamProvider implements TextGenerationStreamProvider {
  private client: GoogleGenerativeAI;
  private configured = false;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GOOGLE_API_KEY;
    this.client = new GoogleGenerativeAI(key ?? '');
    this.configured = !!key;
  }

  getName(): string {
    return 'gemini';
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      throw new StreamingError(
        'PROVIDER_NOT_CONFIGURED',
        'Gemini provider not configured',
        false
      );
    }

    let outputTokens = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError('Gemini stream timeout'));
        }, 30 * 60 * 1000);
      });

      const model = this.client.getGenerativeModel({
        model: input.model,
        systemInstruction: input.systemPrompt
      });

      // Build message history
      const history = input.messages
        .slice(0, -1) // All but last
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

      // Last message as user input
      const userInput = input.messages[input.messages.length - 1]?.content || '';

      const stream = await Promise.race([
        model.generateContentStream({
          contents: [
            ...history,
            { role: 'user', parts: [{ text: userInput }] }
          ],
          generationConfig: {
            maxOutputTokens: input.maxTokens || 1024,
            temperature: input.temperature,
            topP: input.topP,
            topK: input.topK
          }
        }),
        timeout
      ]);

      // Process stream
      for await (const chunk of stream.stream) {
        if (input.abortSignal?.aborted) {
          logger.info('[GeminiStream] Aborted by signal', { model: input.model });
          break;
        }

        const text = chunk.text?.();
        if (text) {
          yield {
            type: StreamChunkType.TOKEN,
            token: text
          };
          outputTokens++;
        }
      }

      // Get final response for token count
      const response = await stream.response;
      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const finalOutputTokens = response.usageMetadata?.candidatesTokenCount || outputTokens;

      yield {
        type: StreamChunkType.USAGE,
        inputTokens,
        outputTokens: finalOutputTokens
      };
    } catch (error: any) {
      logger.error('[GeminiStream] Error', { error: error.message });

      if (error instanceof TimeoutError) {
        throw error;
      }

      if (error.message?.includes('429')) {
        throw new RateLimitError();
      }

      if (error.message?.includes('401') || error.message?.includes('403')) {
        throw new StreamingError('INVALID_API_KEY', 'Gemini API key invalid', false);
      }

      throw new StreamingError('PROVIDER_ERROR', `Gemini error: ${error.message}`, true);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
