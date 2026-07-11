import Anthropic from '@anthropic-ai/sdk';
import {
  type ContentPart,
  type EmbeddingOptions,
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

type AnthropicContentBlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam;

const STOP_REASON_MAP: Record<string, FinishReason> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
};

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/;

/** This SDK version only accepts base64-inlined images, so a `data:` URL is required. */
function toAnthropicImageSource(url: string): Anthropic.ImageBlockParam.Source {
  const match = DATA_URL_RE.exec(url);
  if (!match || !match[1] || !match[2]) {
    throw new ProviderError(
      'AnthropicProvider only accepts images as base64 "data:" URLs; got a non-data URL. ' +
        'Fetch and inline the image before calling generate()/stream().',
    );
  }
  return {
    type: 'base64',
    media_type: match[1] as Anthropic.ImageBlockParam.Source['media_type'],
    data: match[2],
  };
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue; // handled via top-level `system`

    if (message.role === 'tool') {
      const blocks: Anthropic.ToolResultBlockParam[] = message.content
        .filter(
          (part): part is Extract<ContentPart, { type: 'tool_result' }> =>
            part.type === 'tool_result',
        )
        .map((part) => ({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: typeof part.output === 'string' ? part.output : JSON.stringify(part.output),
          is_error: part.isError,
        }));
      result.push({ role: 'user', content: blocks });
      continue;
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const blocks: AnthropicContentBlockParam[] = message.content.map(
      (part): AnthropicContentBlockParam => {
        switch (part.type) {
          case 'text':
            return { type: 'text', text: part.text };
          case 'image':
            return { type: 'image', source: toAnthropicImageSource(part.url) };
          case 'tool_call':
            return {
              type: 'tool_use',
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            };
          case 'tool_result':
            return {
              type: 'tool_result',
              tool_use_id: part.toolCallId,
              content: typeof part.output === 'string' ? part.output : JSON.stringify(part.output),
              is_error: part.isError,
            };
        }
      },
    );
    result.push({ role, content: blocks });
  }
  return result;
}

function fromAnthropicContent(content: Anthropic.ContentBlock[]): ContentPart[] {
  return content.map((block): ContentPart => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'tool_use') {
      return {
        type: 'tool_call',
        toolCallId: asToolCallId(block.id),
        toolName: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
    return { type: 'text', text: '' };
  });
}

function toAnthropicTools(tools?: GenerateOptions['tools']): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function toAnthropicToolChoice(
  choice: GenerateOptions['toolChoice'],
): Anthropic.MessageCreateParams['tool_choice'] {
  if (!choice || choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return undefined;
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.toolName };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
}

/** Adapter binding Anthropic's Messages API to the platform-wide ModelProvider port. */
export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic';
  readonly capabilities = { streaming: true, toolCalling: true, vision: true, embeddings: false };

  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    try {
      const response = await this.client.messages.create(
        {
          model: options.model,
          system: options.system,
          messages: toAnthropicMessages(options.messages),
          tools: toAnthropicTools(options.tools),
          tool_choice: toAnthropicToolChoice(options.toolChoice),
          max_tokens: options.maxOutputTokens ?? 4096,
          temperature: options.temperature,
          stop_sequences: options.stopSequences,
        },
        { signal: options.signal },
      );

      return {
        message: {
          id: asMessageId(response.id),
          role: 'assistant',
          content: fromAnthropicContent(response.content),
          createdAt: new Date().toISOString(),
        },
        finishReason: STOP_REASON_MAP[response.stop_reason ?? 'end_turn'] ?? 'stop',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        raw: response,
      };
    } catch (error) {
      throw new ProviderError(`Anthropic generate() failed: ${(error as Error).message}`, {
        cause: error,
        retryable: isRetryable(error),
      });
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamEvent> {
    const activeToolBlocks: Record<number, { id: string; name: string }> = {};
    try {
      const stream = this.client.messages.stream(
        {
          model: options.model,
          system: options.system,
          messages: toAnthropicMessages(options.messages),
          tools: toAnthropicTools(options.tools),
          tool_choice: toAnthropicToolChoice(options.toolChoice),
          max_tokens: options.maxOutputTokens ?? 4096,
          temperature: options.temperature,
          stop_sequences: options.stopSequences,
        },
        { signal: options.signal },
      );

      yield { type: 'message_start' };

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          activeToolBlocks[event.index] = {
            id: event.content_block.id,
            name: event.content_block.name,
          };
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const block = activeToolBlocks[event.index];
            if (block) {
              yield {
                type: 'tool_call_delta',
                toolCallId: block.id,
                toolName: block.name,
                inputJsonDelta: event.delta.partial_json,
              };
            }
          }
        } else if (event.type === 'message_delta') {
          const usage = await stream
            .finalMessage()
            .then((m) => m.usage)
            .catch(() => undefined);
          yield {
            type: 'message_stop',
            finishReason: STOP_REASON_MAP[event.delta.stop_reason ?? 'end_turn'] ?? 'stop',
            usage: usage
              ? {
                  inputTokens: usage.input_tokens,
                  outputTokens: usage.output_tokens,
                  totalTokens: usage.input_tokens + usage.output_tokens,
                }
              : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        }
      }
    } catch (error) {
      yield { type: 'error', error: error as Error };
    }
  }

  async embed(_options: EmbeddingOptions): Promise<EmbeddingResult> {
    throw new ProviderError(
      'Anthropic provider does not support embeddings; use an EmbeddingProvider instead.',
    );
  }
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}
