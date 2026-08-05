import OpenAI from 'openai';
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
import { resolveSystemPrompt, resolveConversationTurns, DEFAULT_MAX_TOKENS } from '../shared';
import type { AIProviderDescriptor, CredentialVerification } from '../types/descriptor';

/**
 * Generic adapter for any provider that exposes an OpenAI-compatible chat
 * completions endpoint (`POST /chat/completions`) — OpenAI itself, Together
 * AI, DeepSeek, OpenRouter, and xAI Grok all document exactly this
 * compatibility and are configured purely via a base URL + API key, with no
 * other request/response differences this application needs to handle. One
 * class, one set of tests; each provider's own file
 * (openai/together/deepseek/openrouter/xai) only supplies its id, base URL,
 * and default model.
 */
export class OpenAICompatibleTextProvider implements TextGenerationProvider {
  readonly capabilities: readonly AICapability[] = [
    'text-generation',
    'code-generation',
    'tool-calling',
  ];

  constructor(
    readonly id: string,
    private readonly client: OpenAI,
    private readonly defaultModel: string
  ) {}

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const model = request.model ?? this.defaultModel;
    const systemPrompt = resolveSystemPrompt(request);

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          ...resolveConversationTurns(request).flatMap(toOpenAIMessages),
        ],
        ...toolParams(request),
      });

      const choice = response.choices[0];
      const toolCalls = this.readToolCalls(choice?.message?.tool_calls);

      return {
        text: choice?.message?.content ?? '',
        provider: this.id,
        model: response.model,
        usage: {
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        },
        finishReason: choice?.finish_reason ?? undefined,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `${this.id} text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }

  /**
   * OpenAI sends tool arguments as a JSON **string**, so unlike Anthropic
   * (which sends a real object) they have to be parsed — and parsing can
   * fail on a truncated or malformed blob. A failure is raised by name
   * rather than guessed at or silently dropped: running a tool with
   * half-understood arguments is how an automation does the wrong thing
   * confidently.
   */
  private readToolCalls(
    rawCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
  ): AIToolCall[] {
    if (!rawCalls?.length) return [];

    return rawCalls
      .filter((call) => call.type === 'function')
      .map((call) => {
        const raw = call.function.arguments;
        let input: Record<string, unknown>;
        try {
          // An argument-less tool call legitimately arrives as '' or '{}'.
          input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          throw new AIProviderError(
            `${this.id} returned unparseable arguments for tool "${call.function.name}". ` +
              'The call was not run.',
            this.id
          );
        }
        return { id: call.id, name: call.function.name, input };
      });
  }
}

/** Tool parameters in OpenAI's spelling. All three choices map directly. */
function toolParams(request: TextGenerationRequest): {
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
} {
  if (!request.tools?.length) return {};

  return {
    tools: request.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
  };
}

/**
 * One Synora turn becomes one OR MORE OpenAI messages: every tool result is
 * its own `role: 'tool'` message carrying the id of the call it answers.
 * That is the structural difference from Anthropic (blocks inside one turn),
 * and the reason this returns an array.
 */
function toOpenAIMessages(
  turn: ConversationMessage
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (turn.toolCalls?.length) {
    return [
      {
        role: 'assistant',
        // null, not '': OpenAI rejects an empty string alongside tool_calls.
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      },
    ];
  }

  if (turn.toolResults?.length) {
    return [
      ...turn.toolResults.map((result) => ({
        role: 'tool' as const,
        tool_call_id: result.toolCallId,
        // OpenAI has no is_error flag; saying so in the content is the only
        // way the model learns the tool failed rather than returned this.
        content: result.isError ? `ERROR: ${result.content}` : result.content,
      })),
      ...(turn.content ? [{ role: 'user' as const, content: turn.content }] : []),
    ];
  }

  return [{ role: turn.role as 'user' | 'assistant', content: turn.content }];
}

export const openaiDescriptor: AIProviderDescriptor = {
  id: 'openai',
  displayName: 'OpenAI',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  async isConfigured() {
    return (await secretsManager.tryGet('OPENAI_API_KEY', 'ai:openai')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('OPENAI_API_KEY', 'ai:openai');
    return new OpenAICompatibleTextProvider(
      'openai',
      new OpenAI({ apiKey }),
      getConfig().ai.openaiModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('OPENAI_API_KEY', 'ai:openai');
    return verifyOpenAICompatibleKey(new OpenAI({ apiKey }), 'OpenAI');
  },
};

/**
 * Shared verification for every OpenAI-compatible provider. `models.list`
 * is unauthenticated-safe to call, costs no tokens, and returns 401 for a
 * bad key — so checking a credential never bills the founder.
 *
 * Exported so each compatible provider (xAI, DeepSeek, Together,
 * OpenRouter) verifies through the same code path it generates through,
 * rather than growing its own slightly-different check that could drift.
 */
export async function verifyOpenAICompatibleKey(
  client: OpenAI,
  displayName: string
): Promise<CredentialVerification> {
  await client.models.list();
  return {
    status: 'verified',
    detail: `${displayName} accepted the API key.`,
  };
}
