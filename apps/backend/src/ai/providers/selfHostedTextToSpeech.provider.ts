import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { getConfig } from '../../config';
import type { TextToSpeechProvider } from '../types';
import type { AIProviderDescriptor } from '../types/descriptor';
import { OpenAITextToSpeechProvider } from './openaiTextToSpeech.provider';

/**
 * Self-hosted text-to-speech. Targets the OpenAI-compatible
 * `/v1/audio/speech` wire format, which Kokoro-FastAPI and several Piper
 * wrappers implement, so "self-hosted" means any server speaking that
 * protocol and the SDK-backed provider class is reused unchanged.
 *
 * Which languages and voices work is a property of the server and model, not
 * of this adapter: nothing here claims Hindi support. Verify with a real
 * synthesis before telling a user a language is available.
 *
 * Activated by `TTS_SELF_HOSTED_BASE_URL`. An API key is optional.
 */
export const selfHostedTextToSpeechDescriptor: AIProviderDescriptor<TextToSpeechProvider> = {
  id: 'self-hosted-tts',
  displayName: 'Self-Hosted Text-to-Speech',
  capabilities: ['text-to-speech'],
  // Cost depends on where the operator hosts it; the adapter cannot know.
  async isConfigured() {
    return Boolean(getConfig().ai.ttsSelfHostedBaseUrl);
  },
  async create() {
    const { ttsSelfHostedBaseUrl, ttsSelfHostedApiKey, ttsSelfHostedModel, ttsSelfHostedVoice } =
      getConfig().ai;
    if (!ttsSelfHostedBaseUrl) {
      throw new Error('Self-hosted text-to-speech requires TTS_SELF_HOSTED_BASE_URL to be set.');
    }
    return new OpenAITextToSpeechProvider(
      'self-hosted-tts',
      new OpenAI({
        ...SDK_CLIENT_OPTIONS,
        apiKey: ttsSelfHostedApiKey || 'tts-endpoint-does-not-require-an-api-key',
        baseURL: ttsSelfHostedBaseUrl,
      }),
      ttsSelfHostedModel,
      ttsSelfHostedVoice
    );
  },
};
