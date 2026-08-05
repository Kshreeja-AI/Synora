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
