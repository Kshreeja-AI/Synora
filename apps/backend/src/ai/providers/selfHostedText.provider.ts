import OpenAI from 'openai';
import { getConfig } from '../../config';
import type { AIProviderDescriptor } from '../types/descriptor';
import {
  OpenAICompatibleTextProvider,
  verifyOpenAICompatibleKey,
} from './openaiCompatible.provider';

/**
 * Any OpenAI-compatible text-generation server, from environment variables
 * alone — the text twin of `embeddings/providers/selfHosted.provider.ts`.
 *
 * "Self-hosted" here means "any OpenAI-compatible endpoint", not a
 * specific engine: vLLM, TGI, llama.cpp's server, LM Studio, a second
 * Ollama box — all speak this protocol. This descriptor is what makes the
 * founder's runtime-replacement requirement a CONFIG change instead of a
 * code change: the day Ollama is swapped for vLLM on the GPU box, the only
 * thing that changes is three environment variables.
 *
 * CONFIGURED REQUIRES BOTH URL AND MODEL, unlike Ollama (which has a
 * sensible default model name). A generic endpoint's model id genuinely
 * cannot be guessed — vLLM serves whatever it was launched with, often a
 * long HF path — and guessing would produce a provider that looks ready
 * and fails on first use, the exact placeholder dishonesty slice 13
 * eliminated.
 *
 * Deliberately omits `tool-calling` from capabilities, same honesty rule
 * as the Ollama descriptor: an unknown server with an unknown model has
 * not demonstrated reliable tool calls, and advertising them would
 * surface broken behaviour in every feature that trusts the capability
 * flag. The underlying adapter still passes tools through for callers who
 * opt in per-request.
 */
function settings(): { baseUrl?: string; apiKey?: string; model?: string } {
  const { selfHostedTextBaseUrl, selfHostedTextApiKey, selfHostedTextModel } = getConfig().ai;
  return { baseUrl: selfHostedTextBaseUrl, apiKey: selfHostedTextApiKey, model: selfHostedTextModel };
}

function client(baseUrl: string, apiKey?: string): OpenAI {
  return new OpenAI({
    // Optional Bearer token, exactly as the Ollama descriptor: bare local
    // servers ignore it; a protected remote endpoint's proxy checks it.
    apiKey: apiKey || 'self-hosted-does-not-require-an-api-key',
    baseURL: baseUrl,
  });
}

export const selfHostedTextDescriptor: AIProviderDescriptor = {
  id: 'self-hosted',
  displayName: 'Self-hosted (OpenAI-compatible)',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    const { baseUrl, model } = settings();
    return Boolean(baseUrl && model);
  },
  async create() {
    const { baseUrl, apiKey, model } = settings();
    if (!baseUrl || !model) {
      throw new Error(
        'Self-hosted text generation requires SELF_HOSTED_TEXT_BASE_URL and SELF_HOSTED_TEXT_MODEL to be set.'
      );
    }
    return new OpenAICompatibleTextProvider('self-hosted', client(baseUrl, apiKey), model);
  },
  async verifyCredential() {
    const { baseUrl, apiKey } = settings();
    if (!baseUrl) {
      throw new Error('Self-hosted text generation requires SELF_HOSTED_TEXT_BASE_URL to be set.');
    }
    return verifyOpenAICompatibleKey(client(baseUrl, apiKey), 'Self-hosted endpoint');
  },
};
