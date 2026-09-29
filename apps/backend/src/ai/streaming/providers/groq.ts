/**
 * Groq streaming provider — a named instance of the shared
 * OpenAI-compatible stream implementation, against Groq's OpenAI-compatible
 * endpoint (the same one the descriptor-stack Groq provider uses). This
 * retired the `groq-sdk` dependency: the replaced copy was the package's
 * only consumer, and it had to cast around the SDK's chunk type to read
 * usage it never requested.
 *
 * Same two deliberate changes as the other vendor rebases: the credential
 * is read lazily instead of frozen at construction, and
 * `stream_options: { include_usage: true }` is now actually requested —
 * servers that honour it report real token counts to the spend guard;
 * servers that ignore it get the same per-token fallback as before.
 */

import {
  OpenAICompatibleStreamProvider,
  OpenAICompatibleStreamSettings,
} from './openaiCompatible';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export class GroqStreamProvider extends OpenAICompatibleStreamProvider {
  constructor(apiKey?: string) {
    super('groq', (): OpenAICompatibleStreamSettings | null => {
      const key = apiKey || process.env.GROQ_API_KEY;
      return key ? { baseURL: GROQ_BASE_URL, apiKey: key } : null;
    });
  }
}
