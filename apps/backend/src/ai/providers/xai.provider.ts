import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import { AIProviderDescriptor } from '../registry';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

/** xAI documents its Grok API as OpenAI-compatible. */
const XAI_BASE_URL = 'https://api.x.ai/v1';

export const xaiDescriptor: AIProviderDescriptor = {
  id: 'xai',
  displayName: 'xAI Grok',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    return (await secretsManager.tryGet('XAI_API_KEY', 'ai:xai')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('XAI_API_KEY', 'ai:xai');
    return new OpenAICompatibleTextProvider(
      'xai',
      new OpenAI({ apiKey, baseURL: XAI_BASE_URL }),
      getConfig().ai.xaiModel
    );
  },
};
