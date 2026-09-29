/**
 * OpenRouter streaming provider — a named instance of the shared
 * OpenAI-compatible stream implementation, which carries all the wire
 * behaviour (SSE ordering, usage accounting, auth, error mapping) and its
 * tests. This file only pins what is OpenRouter-specific: the endpoint
 * and the credential source.
 *
 * Same two deliberate changes as the DeepSeek rebase: the credential is
 * read lazily instead of frozen at construction, and
 * `stream_options: { include_usage: true }` is now actually requested —
 * the copy this replaced read `chunk.usage` without ever asking for it,
 * so the spend guard only ever saw the per-token estimate.
 */

import {
  OpenAICompatibleStreamProvider,
  OpenAICompatibleStreamSettings,
} from './openaiCompatible';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterStreamProvider extends OpenAICompatibleStreamProvider {
  constructor(apiKey?: string) {
    super('openrouter', (): OpenAICompatibleStreamSettings | null => {
      const key = apiKey || process.env.OPENROUTER_API_KEY;
      return key ? { baseURL: OPENROUTER_BASE_URL, apiKey: key } : null;
    });
  }
}
