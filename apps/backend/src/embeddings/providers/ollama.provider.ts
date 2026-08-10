import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from '../../ai/providers/sdk-options';
import { getConfig } from '../../config';
import type { EmbeddingProviderDescriptor } from '../descriptor';
import { OpenAICompatibleEmbeddingProvider } from './openaiCompatible.provider';

/**
 * Ollama (self-hosted local/on-prem models). Recent Ollama releases expose
 * an OpenAI-compatible `/v1/embeddings` endpoint, so this reuses the same
 * generic adapter as the hosted OpenAI-compatible providers — only the base
 * URL and auth (Ollama needs no real key) differ. Mirrors
 * `../../ai/providers/ollama.provider.ts`.
 *
 * No official per-request batch limit is documented for Ollama's embeddings
 * endpoint; 64 is a conservative default sized for a single local/on-prem
 * instance rather than a hosted multi-tenant API, configurable via
 * `EMBEDDING_OLLAMA_MAX_BATCH_SIZE`.
 */
const OLLAMA_DEFAULT_MAX_BATCH_SIZE = 64;

export const ollamaEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'ollama',
  displayName: 'Ollama',
  async isConfigured() {
    return Boolean(getConfig().embeddings.ollamaBaseUrl);
  },
  async create() {
    const { ollamaBaseUrl, ollamaApiKey, ollamaModel, ollamaMaxBatchSize } = getConfig().embeddings;
    if (!ollamaBaseUrl) {
      throw new Error('Ollama embeddings require EMBEDDING_OLLAMA_BASE_URL to be set.');
    }
    return new OpenAICompatibleEmbeddingProvider(
      'ollama',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, // Same rule as the text twin: a remote endpoint sits behind a
        // token-checking proxy, and this is that token as a Bearer header.
        apiKey: ollamaApiKey || 'ollama-does-not-require-an-api-key',
        baseURL: ollamaBaseUrl, }),
      ollamaModel,
      ollamaMaxBatchSize ?? OLLAMA_DEFAULT_MAX_BATCH_SIZE
    );
  },
};
