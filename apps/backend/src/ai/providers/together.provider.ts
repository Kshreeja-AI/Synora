import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

/** Together AI documents its inference API as OpenAI-compatible. */
const TOGETHER_BASE_URL = 'https://api.together.xyz/v1';

export const togetherDescriptor: AIProviderDescriptor = {
  id: 'together',
  displayName: 'Together AI',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return (await secretsManager.tryGet('TOGETHER_API_KEY', 'ai:together')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('TOGETHER_API_KEY', 'ai:together');
    return new OpenAICompatibleTextProvider(
      'together',
      new OpenAI({ apiKey, baseURL: TOGETHER_BASE_URL }),
      getConfig().ai.togetherModel
    );
  },
};
