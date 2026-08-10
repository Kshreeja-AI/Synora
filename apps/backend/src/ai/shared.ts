import { ConversationMessage, TextGenerationRequest } from './types';

/**
 * Shared, provider-agnostic helpers used by every adapter under
 * ./providers/. Nothing here is specific to any one vendor's SDK or wire
 * format — only to the common request shape defined in ./types.ts.
 */

const DEFAULT_CODE_SYSTEM_PROMPT =
  'You are an expert software engineer. Respond only with correct, ' +
  'production-quality code and the minimal explanation necessary. Prefer ' +
  'complete, runnable code over fragments.';

/**
 * Resolves the effective system prompt for a request: an explicit
 * `systemPrompt` always wins; otherwise `mode: 'code'` gets a sensible
 * code-oriented default; plain text mode has no default system prompt.
 */
export function resolveSystemPrompt(request: TextGenerationRequest): string | undefined {
  if (request.systemPrompt) return request.systemPrompt;
  if (request.mode === 'code') return DEFAULT_CODE_SYSTEM_PROMPT;
  return undefined;
}

export const DEFAULT_MAX_TOKENS = 4096;

/**
 * The full user/assistant turn sequence a provider should send, oldest
 * first: `request.messages` (if any) followed by `request.prompt` as the
 * final user turn. `'system'`-role entries are dropped — `resolveSystemPrompt`
 * is the single source of truth for the one system instruction every
 * provider's wire format allows, so a `system` turn embedded in history
 * would either be rejected by the SDK or silently duplicate it.
 *
 * With no `messages` set, this returns exactly `[{ role: 'user', content:
 * request.prompt }]` — byte-identical to what every provider constructed
 * inline before conversation history existed, so single-shot callers are
 * unaffected.
 *
 * An EMPTY `prompt` appends no final turn. That is what a tool-result
 * continuation looks like: the caller has tool output to send back and no
 * new human input, and inventing an empty user turn would either be
 * rejected by the provider or read to the model as the person going silent.
 * Any `toolCalls`/`toolResults` carried on a history turn pass through
 * untouched here — mapping them to a vendor's wire format is each adapter's
 * job, not this function's.
 */
export function resolveConversationTurns(
  request: TextGenerationRequest
): ConversationMessage[] {
  const history = (request.messages ?? []).filter((message) => message.role !== 'system');
  if (request.prompt === '') return [...history];
  return [...history, { role: 'user', content: request.prompt }];
}

/* ------------------------------------------------------------------ *
 * AN EMPTY ANSWER IS NOT AN ANSWER
 * ------------------------------------------------------------------ */

/**
 * Why a generation produced no text.
 *
 * A model can finish successfully — HTTP 200, no error, real token usage
 * billed — and still return nothing at all. The adapters used to hand that
 * straight on as `text: ''`, and every layer above treated it as a normal
 * reply: the chat worker persisted a blank assistant message and marked
 * the job COMPLETED. The person saw an empty bubble and no reason for it,
 * having just paid for the tokens.
 *
 * The commonest cause is a reasoning model spending its whole output
 * budget on internal reasoning before writing a single word of answer.
 * That is a CONFIGURATION problem with a one-line fix, and it is invisible
 * unless something says so.
 *
 * NOTHING HERE KNOWS ANY MODEL'S NAME, and nothing here injects a control
 * token to suppress reasoning. Both would be a vendor behaviour smuggled
 * into a provider-agnostic layer, and both would be wrong the moment the
 * deployment switched models. This reads only the finish reason every
 * OpenAI-compatible and Anthropic response already carries.
 */
export type EmptyGenerationCause =
  /** The output token budget ran out before any answer was produced. */
  | 'output-budget-exhausted'
  /** The provider's own safety filter removed the response. */
  | 'content-filtered'
  /** Finished normally and still said nothing. */
  | 'no-output';

/**
 * Maps a provider's finish reason onto the shared vocabulary above.
 *
 * The two spellings covered are the two this codebase's adapters actually
 * receive: OpenAI-compatible (`length`, `content_filter`) and Anthropic
 * (`max_tokens`). Gemini's uppercase forms are included because its
 * streaming adapter exists in the same tree. Anything unrecognised falls
 * to `no-output` — an honest "we don't know why", never a guess.
 */
export function classifyEmptyGeneration(finishReason: string | undefined): EmptyGenerationCause {
  switch (finishReason?.toLowerCase()) {
    case 'length':
    case 'max_tokens':
      return 'output-budget-exhausted';
    case 'content_filter':
    case 'safety':
    case 'recitation':
      return 'content-filtered';
    default:
      return 'no-output';
  }
}

/**
 * The sentence a person sees. Written to be actionable by someone who is
 * not an engineer: it names what happened, and what to change.
 */
export function emptyGenerationMessage(
  providerId: string,
  cause: EmptyGenerationCause,
  detail?: { reasonedWithoutAnswering?: boolean }
): string {
  const prefix = `${providerId} returned no answer`;

  switch (cause) {
    case 'output-budget-exhausted':
      return (
        `${prefix}: it used its entire output budget before producing any text. ` +
        (detail?.reasonedWithoutAnswering
          ? 'The whole budget went on internal reasoning. '
          : 'This usually means the model spent the budget reasoning internally. ') +
        'Raise the response length limit, or use a model that reasons less before answering.'
      );
    case 'content-filtered':
      return `${prefix}: the provider's safety filter removed the response.`;
    case 'no-output':
      return (
        `${prefix}: the request completed successfully but the response was empty. ` +
        'Nothing was saved, because a blank reply is not an answer.'
      );
  }
}
