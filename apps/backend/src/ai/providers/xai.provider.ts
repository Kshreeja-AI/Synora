import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/** xAI documents its Grok API as OpenAI-compatible. */
const XAI_BASE_URL = 'https://api.x.ai/v1';

export const xaiDescriptor: AIProviderDescriptor = {
  id: 'xai',
  displayName: 'xAI Grok',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('XAI_API_KEY', 'ai:xai');
  },
  async create() {
    const apiKey = await secretsManager.get('XAI_API_KEY', 'ai:xai');
    return new OpenAICompatibleTextProvider(
      'xai',
      new OpenAI({ apiKey, baseURL: XAI_BASE_URL }),
      getConfig().ai.xaiModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('XAI_API_KEY', 'ai:xai');
    return verifyOpenAICompatibleKey(new OpenAI({ apiKey, baseURL: XAI_BASE_URL }), 'xAI');
  },
};
