import OpenAI from 'openai';
import { getConfig } from '../../config';
import { AIProviderDescriptor } from '../registry';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

/**
 * Ollama (self-hosted local/on-prem models). Ollama exposes an
 * OpenAI-compatible `/v1/chat/completions` endpoint, so this reuses the same
 * generic adapter as the hosted OpenAI-compatible providers — only the base
 * URL and auth (Ollama needs no real key) differ.
 *
 * Activated by setting `OLLAMA_BASE_URL` (e.g. `http://localhost:11434/v1`).
 * Unlike every other provider, Ollama requires no API key — there is no
 * "leaked credential" risk from the placeholder value used below, since
 * Ollama does not check it.
 *
 * Deliberately requires an explicit `OLLAMA_BASE_URL` rather than defaulting
 * to `http://localhost:11434/v1`: unlike every hosted provider, "Ollama is
 * running somewhere" is not a fact this application can safely assume, and a
 * silent default could cause auto-detection to select a local dev server
 * nobody intended to be used in a deployed environment.
 */
export const ollamaDescriptor: AIProviderDescriptor = {
  id: 'ollama',
  displayName: 'Ollama',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return Boolean(getConfig().ai.ollamaBaseUrl);
  },
  async create() {
    const { ollamaBaseUrl, ollamaModel } = getConfig().ai;
    if (!ollamaBaseUrl) {
      throw new Error('Ollama requires OLLAMA_BASE_URL to be set.');
    }
    return new OpenAICompatibleTextProvider(
      'ollama',
      new OpenAI({ apiKey: 'ollama-does-not-require-an-api-key', baseURL: ollamaBaseUrl }),
      ollamaModel
    );
  },
};
