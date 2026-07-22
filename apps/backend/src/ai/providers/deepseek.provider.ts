import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import { AIProviderDescriptor } from '../registry';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

/** DeepSeek documents its API as OpenAI-compatible. */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export const deepseekDescriptor: AIProviderDescriptor = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return (await secretsManager.tryGet('DEEPSEEK_API_KEY', 'ai:deepseek')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('DEEPSEEK_API_KEY', 'ai:deepseek');
    return new OpenAICompatibleTextProvider(
      'deepseek',
      new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL }),
      getConfig().ai.deepseekModel
    );
  },
};
