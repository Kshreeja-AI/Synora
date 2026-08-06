import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/** DeepSeek documents its API as OpenAI-compatible. */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export const deepseekDescriptor: AIProviderDescriptor = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('DEEPSEEK_API_KEY', 'ai:deepseek');
  },
  async create() {
    const apiKey = await secretsManager.get('DEEPSEEK_API_KEY', 'ai:deepseek');
    return new OpenAICompatibleTextProvider(
      'deepseek',
      new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL }),
      getConfig().ai.deepseekModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('DEEPSEEK_API_KEY', 'ai:deepseek');
    return verifyOpenAICompatibleKey(new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL }), 'DeepSeek');
  },
};
