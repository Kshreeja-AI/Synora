/**
 * Generic streaming provider for ANY OpenAI-compatible endpoint — remote
 * Ollama, vLLM, TGI, llama.cpp server. One implementation instead of a
 * fourth copy of the ~120-line body openai.ts / deepseek.ts / openrouter.ts
 * each carry.
 *
 * Two deliberate departures from the existing streaming adapters:
 *
 * 1. Settings come from a CALLBACK, resolved at stream time — not from
 *    `process.env` read at construction. The other adapters read env
 *    directly, which bypasses the config layer's validation and defaults;
 *    these factories are the first to do it through `getConfig()`, and the
 *    lazy callback keeps the streaming resolver's construct-early,
 *    configure-later lifecycle working.
 *
 * 2. `stream_options: { include_usage: true }` is requested. Recent
 *    OpenAI-compatible servers (including current Ollama) then report real
 *    token usage in a final chunk; servers that ignore the option simply
 *    omit it. When no usage arrives, the final USAGE chunk carries the
 *    per-token fallback count with `inputTokens: 0` — and the chat worker
 *    treats that shape as "unreported", so the spend guard charges its
 *    estimated floor instead of reading the stream as free.
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
  StreamingError,
} from '../types';

export interface OpenAICompatibleStreamSettings {
  baseURL: string;
  /** Optional Bearer token for a protected endpoint (the fronting proxy's). */
  apiKey?: string;
}

const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

export class OpenAICompatibleStreamProvider implements TextGenerationStreamProvider {
  constructor(
    private readonly name: string,
    private readonly getSettings: () => OpenAICompatibleStreamSettings | null
  ) {}

  getName(): string {
    return this.name;
  }

  isConfigured(): boolean {
    return this.getSettings() !== null;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    const settings = this.getSettings();
    if (!settings) {
      throw new StreamingError(
        'PROVIDER_NOT_CONFIGURED',
        `${this.name} provider not configured`,
        false
      );
    }

    const client = new OpenAI({
      apiKey: settings.apiKey || `${this.name}-does-not-require-an-api-key`,
      baseURL: settings.baseURL,
    });

    let outputTokens = 0;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError(`${this.name} stream timeout`));
        }, STREAM_TIMEOUT_MS);
      });

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (input.systemPrompt) {
        messages.push({ role: 'system', content: input.systemPrompt });
      }
      messages.push(
        ...input.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      );

      const stream = await Promise.race([
        client.chat.completions.create({
          model: input.model,
          messages,
          max_tokens: input.maxTokens || 1024,
          temperature: input.temperature,
          top_p: input.topP,
          stream: true,
          stream_options: { include_usage: true },
        }),
        timeout,
      ]);

      let inputTokens = 0;
      let usageReported = false;

      for await (const chunk of stream) {
        if (input.abortSignal?.aborted) {
          logger.info(`[${this.name}Stream] Aborted`, { model: input.model });
          break;
        }

        if (chunk.choices[0]?.delta?.content) {
          yield {
            type: StreamChunkType.TOKEN,
            token: chunk.choices[0].delta.content,
          };
          outputTokens++;
        }

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
          usageReported = true;
        }
      }

      // Server-reported numbers when they came; otherwise the per-token
      // fallback with inputTokens 0 — the exact shape downstream treats as
      // "the provider reported nothing", so unknown never reads as free.
      yield {
        type: StreamChunkType.USAGE,
        inputTokens: usageReported ? inputTokens : 0,
        outputTokens,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; status?: number };
      logger.error(`[${this.name}Stream] Error`, { error: err.message });

      if (error instanceof TimeoutError) throw error;
      if (err.status === 429) throw new RateLimitError();
      if (err.status === 401 || err.status === 403) {
        throw new StreamingError(
          'INVALID_API_KEY',
          `${this.name} endpoint refused the token`,
          false
        );
      }

      throw new StreamingError('PROVIDER_ERROR', `${this.name} error: ${err.message}`, true);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
