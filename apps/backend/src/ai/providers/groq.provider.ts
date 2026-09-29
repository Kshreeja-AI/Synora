import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/**
 * Groq — hosted inference for open-source models on custom hardware, with
 * a genuinely usable free tier. That combination matters to this platform
 * specifically: it is the cheapest hosted path to the SAME open-source
 * model families the self-hosted strategy targets, which makes it a
 * like-for-like reference point when benchmarking a GPU-box deployment.
 *
 * A streaming adapter for Groq already existed (ai/streaming/providers);
 * this descriptor closes the odd gap where Synora could stream from Groq
 * but not serve a plain generateText through the resolver. Same
 * OpenAI-compatible wire protocol, same shared adapter, same verification
 * path as every other compatible provider.
 */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export const groqDescriptor: AIProviderDescriptor = {
  id: 'groq',
  displayName: 'Groq',
  capabilities: ['text-generation', 'code-generation', 'tool-calling'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('GROQ_API_KEY', 'ai:groq');
  },
  async create() {
    const apiKey = await secretsManager.get('GROQ_API_KEY', 'ai:groq');
    return new OpenAICompatibleTextProvider(
      'groq',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: GROQ_BASE_URL }),
      getConfig().ai.groqModel
    );
  },
  async verifyCredential() {
    const apiKey = await secretsManager.get('GROQ_API_KEY', 'ai:groq');
    return verifyOpenAICompatibleKey(new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: GROQ_BASE_URL }), 'Groq');
  },
};
