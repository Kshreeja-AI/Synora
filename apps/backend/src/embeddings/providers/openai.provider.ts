import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from '../../ai/providers/sdk-options';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { EmbeddingProviderDescriptor } from '../descriptor';
import { OpenAICompatibleEmbeddingProvider } from './openaiCompatible.provider';

/**
 * OpenAI's embeddings endpoint (`POST /v1/embeddings`) accepts up to 2048
 * inputs per request — this is OpenAI's own documented limit, not an
 * arbitrary choice.
 */
const OPENAI_MAX_BATCH_SIZE = 2048;

export const openaiEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'openai',
  displayName: 'OpenAI',
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('OPENAI_API_KEY', 'embeddings:openai');
  },
  async create() {
    const apiKey = await secretsManager.get('OPENAI_API_KEY', 'embeddings:openai');
    return new OpenAICompatibleEmbeddingProvider(
      'openai',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey }),
      getConfig().embeddings.openaiModel,
      OPENAI_MAX_BATCH_SIZE
    );
  },
};
