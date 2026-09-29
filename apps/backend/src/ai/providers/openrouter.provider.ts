import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/** OpenRouter documents its API as OpenAI-compatible. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const openrouterDescriptor: AIProviderDescriptor = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('OPENROUTER_API_KEY', 'ai:openrouter');
  },
  async create() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return new OpenAICompatibleTextProvider(
      'openrouter',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: OPENROUTER_BASE_URL }),
      getConfig().ai.openrouterModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return verifyOpenAICompatibleKey(new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: OPENROUTER_BASE_URL }), 'OpenRouter');
  },
};
