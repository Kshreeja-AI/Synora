import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import { AIProviderDescriptor } from '../registry';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

/** OpenRouter documents its API as OpenAI-compatible. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const openrouterDescriptor: AIProviderDescriptor = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return (await secretsManager.tryGet('OPENROUTER_API_KEY', 'ai:openrouter')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return new OpenAICompatibleTextProvider(
      'openrouter',
      new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL }),
      getConfig().ai.openrouterModel
    );
  },
};
