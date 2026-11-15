import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from '../../ai/providers/sdk-options';
import { secretsManager } from '../../secrets';
import type { EmbeddingProviderDescriptor } from '../descriptor';
import { OpenAICompatibleEmbeddingProvider } from './openaiCompatible.provider';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b:free';
const MAX_BATCH_SIZE = 64;

/** OpenRouter's documented /embeddings endpoint uses the OpenAI wire shape. */
export const openrouterEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'openrouter',
  displayName: 'OpenRouter Embeddings',
  async isConfigured() {
    return secretsManager.hasReal('OPENROUTER_API_KEY', 'ai:openrouter');
  },
  async create() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return new OpenAICompatibleEmbeddingProvider(
      'openrouter',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: OPENROUTER_BASE_URL }),
      DEFAULT_OPENROUTER_EMBEDDING_MODEL,
      MAX_BATCH_SIZE
    );
  },
};
