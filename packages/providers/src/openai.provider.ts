import {
  type ContentPart,
  type EmbeddingOptions,
  type EmbeddingProvider,
  type EmbeddingResult,
  type FinishReason,
  type GenerateOptions,
  type GenerateResult,
  type Message,
  type ModelProvider,
  ProviderError,
  type StreamEvent,
  asMessageId,
  asToolCallId,
} from '@synora/core';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index';

const FINISH_REASON_MAP: Record<string, FinishReason> = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_calls',
  content_filter: 'content_filter',
  function_call: 'tool_calls',
};

function toOpenAiMessages(messages: Message[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool_result') continue;
        result.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: typeof part.output === 'string' ? part.output : JSON.stringify(part.output),
        });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const textParts = message.content.filter(
        (p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text',
      );
      const toolCallParts = message.content.filter(
        (p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call',
      );
      result.push({
        role: 'assistant',
        content: textParts.map((p) => p.text).join('') || null,
        tool_calls: toolCallParts.length
          ? toolCallParts.map((tc) => ({
              id: tc.toolCallId,
              type: 'function',
              function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
            }))
          : undefined,
      });
      continue;
    }

    const role = message.role === 'system' ? 'system' : 'user';
    const hasNonText = message.content.some((p) => p.type !== 'text');
    if (!hasNonText) {
      result.push({
        role,
        content: message.content.map((p) => (p.type === 'text' ? p.text : '')).join(''),
      } as ChatCompletionMessageParam);
      continue;
    }
    result.push({
      role: 'user',
      content: message.content.map((part) => {
        if (part.type === 'text') return { type: 'text' as const, text: part.text };
        if (part.type === 'image')
          return { type: 'image_url' as const, image_url: { url: part.url } };
        return { type: 'text' as const, text: '' };
      }),
    });
  }
  return result;
}

function toOpenAiTools(tools?: GenerateOptions['tools']): ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

function toOpenAiToolChoice(
  choice: GenerateOptions['toolChoice'],
): OpenAI.ChatCompletionToolChoiceOption | undefined {
  if (!choice || choice === 'auto') return 'auto';
  if (choice === 'none') return 'none';
  if (choice === 'required') return 'required';
  return { type: 'function', function: { name: choice.toolName } };
}

export interface OpenAiProviderOptions {
  apiKey: string;
  baseURL?: string;
}

/** Adapter binding OpenAI's Chat Completions API to the platform-wide ModelProvider port. */
export class OpenAiProvider implements ModelProvider {
  readonly id = 'openai';
  readonly capabilities = { streaming: true, toolCalling: true, vision: true, embeddings: true };

  private readonly client: OpenAI;

  constructor(options: OpenAiProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    try {
      const messages = options.system
        ? [
            { role: 'system' as const, content: options.system },
            ...toOpenAiMessages(options.messages),
          ]
        : toOpenAiMessages(options.messages);

      const response = await this.client.chat.completions.create(
        {
          model: options.model,
          messages,
          tools: toOpenAiTools(options.tools),
          tool_choice: toOpenAiToolChoice(options.toolChoice),
          temperature: options.temperature,
          max_tokens: options.maxOutputTokens,
          stop: options.stopSequences,
        },
        { signal: options.signal },
      );

      const choice = response.choices[0];
      if (!choice) throw new Error('OpenAI response contained no choices');

      const content: ContentPart[] = [];
      if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
      for (const toolCall of choice.message.tool_calls ?? []) {
        content.push({
          type: 'tool_call',
          toolCallId: asToolCallId(toolCall.id),
          toolName: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || '{}'),
        });
      }

      return {
        message: {
          id: asMessageId(response.id),
          role: 'assistant',
          content,
          createdAt: new Date().toISOString(),
        },
        finishReason: FINISH_REASON_MAP[choice.finish_reason] ?? 'stop',
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        raw: response,
      };
    } catch (error) {
      throw new ProviderError(`OpenAI generate() failed: ${(error as Error).message}`, {
        cause: error,
        retryable: isRetryable(error),
      });
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamEvent> {
    const toolCallIndex: Record<number, { id: string; name: string }> = {};
    try {
      const messages = options.system
        ? [
            { role: 'system' as const, content: options.system },
            ...toOpenAiMessages(options.messages),
          ]
        : toOpenAiMessages(options.messages);

      const stream = await this.client.chat.completions.create(
        {
          model: options.model,
          messages,
          tools: toOpenAiTools(options.tools),
          tool_choice: toOpenAiToolChoice(options.toolChoice),
          temperature: options.temperature,
          max_tokens: options.maxOutputTokens,
          stop: options.stopSequences,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: options.signal },
      );

      yield { type: 'message_start' };

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          yield { type: 'text_delta', text: choice.delta.content };
        }
        for (const toolCallDelta of choice?.delta?.tool_calls ?? []) {
          const idx = toolCallDelta.index;
          if (toolCallDelta.id && toolCallDelta.function?.name) {
            toolCallIndex[idx] = { id: toolCallDelta.id, name: toolCallDelta.function.name };
          }
          const info = toolCallIndex[idx];
          if (info) {
            yield {
              type: 'tool_call_delta',
              toolCallId: info.id,
              toolName: info.name,
              inputJsonDelta: toolCallDelta.function?.arguments ?? '',
            };
          }
        }
        if (choice?.finish_reason) {
          yield {
            type: 'message_stop',
            finishReason: FINISH_REASON_MAP[choice.finish_reason] ?? 'stop',
            usage: chunk.usage
              ? {
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens,
                }
              : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        }
      }
    } catch (error) {
      yield { type: 'error', error: error as Error };
    }
  }

  async embed(options: EmbeddingOptions): Promise<EmbeddingResult> {
    try {
      const response = await this.client.embeddings.create({
        model: options.model,
        input: options.input,
      });
      return {
        vectors: response.data.map((d) => d.embedding),
        usage: { inputTokens: response.usage.prompt_tokens },
      };
    } catch (error) {
      throw new ProviderError(`OpenAI embed() failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}

/** Standalone EmbeddingProvider (packages/memory port) backed by OpenAI, usable independent of the chat model. */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: { apiKey: string; model?: string; dimensions?: number; baseURL?: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    this.model = options.model ?? 'text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({ model: this.model, input: texts });
    return response.data.map((d) => d.embedding);
  }
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}
