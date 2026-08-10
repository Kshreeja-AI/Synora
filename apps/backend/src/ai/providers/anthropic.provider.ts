import Anthropic from '@anthropic-ai/sdk';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  AIToolCall,
  ConversationMessage,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from '../types';
import {
  resolveSystemPrompt,
  resolveConversationTurns,
  DEFAULT_MAX_TOKENS,
  classifyEmptyGeneration,
  emptyGenerationMessage,
} from '../shared';
import type { AIProviderDescriptor } from '../types/descriptor';

/**
 * Release 1's default text/code generation provider. Activated purely by
 * setting `ANTHROPIC_API_KEY` — no code change. Model is
 * `ANTHROPIC_MODEL` (config: `ai.anthropicModel`), defaulting to
 * `claude-sonnet-5`.
 */
export class AnthropicTextProvider implements TextGenerationProvider {
  readonly id = 'anthropic';
  readonly capabilities: readonly AICapability[] = [
    'text-generation',
    'code-generation',
    'tool-calling',
  ];

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
        messages: resolveConversationTurns(request).map(toAnthropicMessage),
        ...toolParams(request),
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const toolCalls: AIToolCall[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        }));

      // Same rule as every other adapter: a 200 with no text is not a
      // reply. Anthropic reaches it the same way — thinking blocks consume
      // the output budget, `stop_reason` comes back `max_tokens`, and the
      // text blocks this filters for are simply absent. Empty alongside
      // tool calls stays legitimate.
      if (text.trim() === '' && toolCalls.length === 0) {
        throw new AIProviderError(
          emptyGenerationMessage(
            this.id,
            classifyEmptyGeneration(response.stop_reason ?? undefined)
          ),
          this.id
        );
      }

      return {
        text,
        provider: this.id,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
        finishReason: response.stop_reason ?? undefined,
        // Absent rather than empty when the model chose prose — see the
        // contract note on TextGenerationResult.toolCalls.
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (error) {
      // Already ours — rethrow as-is. Wrapping it would bury a precise,
      // actionable message ("raise the response length limit") inside a
      // generic "text generation failed", which reads like a provider
      // outage and sends the reader to the wrong place. The
      // OpenAI-compatible adapter has always done this; Anthropic did not,
      // and the empty-response check above is the first error raised here
      // that the wrapper would have damaged.
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `Anthropic text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

/**
 * Tool parameters in Anthropic's spelling. `none` is expressed by sending no
 * tools at all rather than `tool_choice: {type: 'none'}`: the observable
 * outcome (the model cannot call a tool this turn) is identical, and it works
 * on every API version rather than only those that added the `none` variant.
 */
function toolParams(request: TextGenerationRequest): {
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.ToolChoice;
} {
  if (!request.tools?.length || request.toolChoice === 'none') return {};

  return {
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    })),
    ...(request.toolChoice === 'required'
      ? { tool_choice: { type: 'any' as const } }
      : {}),
  };
}

/**
 * One Synora turn becomes one Anthropic message. Anthropic carries both tool
 * calls and tool results as content BLOCKS inside a normal turn (assistant
 * and user respectively), so the turn count never changes — unlike OpenAI,
 * where each tool result is its own message.
 */
function toAnthropicMessage(turn: ConversationMessage): Anthropic.MessageParam {
  const role = turn.role as 'user' | 'assistant';

  if (turn.toolCalls?.length) {
    return {
      role,
      content: [
        ...(turn.content ? [{ type: 'text' as const, text: turn.content }] : []),
        ...turn.toolCalls.map((call) => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      ],
    };
  }

  if (turn.toolResults?.length) {
    return {
      role,
      content: [
        // Results first: they answer the previous turn, so anything the
        // caller adds is commentary on top of them, not before them.
        ...turn.toolResults.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.toolCallId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
        ...(turn.content ? [{ type: 'text' as const, text: turn.content }] : []),
      ],
    };
  }

  return { role, content: turn.content };
}

export const anthropicDescriptor: AIProviderDescriptor = {
  id: 'anthropic',
  displayName: 'Anthropic Claude',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('ANTHROPIC_API_KEY', 'ai:anthropic');
  },
  async create() {
    const apiKey = await secretsManager.get('ANTHROPIC_API_KEY', 'ai:anthropic');
    return new AnthropicTextProvider(new Anthropic({ ...SDK_CLIENT_OPTIONS, apiKey }), getConfig().ai.anthropicModel);
  },
  /**
   * `models.list` is the cheapest authenticated call Anthropic exposes: it
   * costs no tokens, so verifying a key never bills the founder, and a 401
   * from it is unambiguous proof the key is bad.
   */
  async verifyCredential() {
    const apiKey = await secretsManager.get('ANTHROPIC_API_KEY', 'ai:anthropic');
    await new Anthropic({ ...SDK_CLIENT_OPTIONS, apiKey }).models.list({ limit: 1 });
    return {
      status: 'verified' as const,
      detail: 'Anthropic accepted the API key.',
    };
  },
};
