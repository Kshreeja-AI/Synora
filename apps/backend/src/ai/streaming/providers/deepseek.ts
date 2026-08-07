/**
 * DeepSeek streaming provider — a named instance of the shared
 * OpenAI-compatible stream implementation, which carries all the wire
 * behaviour (SSE ordering, usage accounting, auth, error mapping) and its
 * tests. This file only pins what is DeepSeek-specific: the endpoint and
 * the credential source.
 *
 * Two deliberate changes from the copy this replaced:
 *
 * 1. The credential is read LAZILY (at isConfigured/stream time), not
 *    frozen at construction — a key set after startup is now seen. It
 *    still comes from process.env like the other vendor adapters; only
 *    the endpoint-driven providers (ollama/self-hosted) go through
 *    getConfig().
 *
 * 2. `stream_options: { include_usage: true }` is now actually requested.
 *    The old copy read `chunk.usage` without ever asking for it, so
 *    server-reported usage never arrived and every stream fell back to
 *    the per-token count — the spend guard was always estimating.
 */

import {
  OpenAICompatibleStreamProvider,
  OpenAICompatibleStreamSettings,
} from './openaiCompatible';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/beta';

export class DeepSeekStreamProvider extends OpenAICompatibleStreamProvider {
  constructor(apiKey?: string) {
    super('deepseek', (): OpenAICompatibleStreamSettings | null => {
      const key = apiKey || process.env.DEEPSEEK_API_KEY;
      return key ? { baseURL: DEEPSEEK_BASE_URL, apiKey: key } : null;
    });
  }
}
