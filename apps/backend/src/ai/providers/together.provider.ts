import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/** Together AI documents its inference API as OpenAI-compatible. */
const TOGETHER_BASE_URL = 'https://api.together.xyz/v1';

export const togetherDescriptor: AIProviderDescriptor = {
  id: 'together',
  displayName: 'Together AI',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('TOGETHER_API_KEY', 'ai:together');
  },
  async create() {
    const apiKey = await secretsManager.get('TOGETHER_API_KEY', 'ai:together');
    return new OpenAICompatibleTextProvider(
      'together',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: TOGETHER_BASE_URL }),
      getConfig().ai.togetherModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('TOGETHER_API_KEY', 'ai:together');
    return verifyOpenAICompatibleKey(new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: TOGETHER_BASE_URL }), 'Together AI');
  },
};
