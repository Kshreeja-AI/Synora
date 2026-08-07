import OpenAI from 'openai';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/**
 * Bare Ollama checks no API key — but a REMOTE deployment must never be
 * exposed raw, and the token its fronting proxy checks arrives here as
 * `OLLAMA_API_KEY`, sent as a standard Bearer header. The placeholder is
 * kept for the unprotected local case because the SDK requires a non-empty
 * string; Ollama itself ignores it.
 */
function ollamaClient(): OpenAI {
  const { ollamaBaseUrl, ollamaApiKey } = getConfig().ai;
  if (!ollamaBaseUrl) {
    throw new Error('Ollama requires OLLAMA_BASE_URL to be set.');
  }
  return new OpenAI({
    apiKey: ollamaApiKey || 'ollama-does-not-require-an-api-key',
    baseURL: ollamaBaseUrl,
  });
}

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
    const { ollamaModel } = getConfig().ai;
    return new OpenAICompatibleTextProvider('ollama', ollamaClient(), ollamaModel);
  },
  /**
   * `models.list` costs no tokens and returns 401 through a token-checking
   * proxy — so a wrong or missing OLLAMA_API_KEY is caught at readiness
   * time, not on a user's first message. Verifies through the same client
   * construction the generation path uses; a separate check could drift.
   */
  async verifyCredential() {
    return verifyOpenAICompatibleKey(ollamaClient(), 'Ollama');
  },
};
