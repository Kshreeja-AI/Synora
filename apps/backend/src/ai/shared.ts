import { TextGenerationRequest } from './types';

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
