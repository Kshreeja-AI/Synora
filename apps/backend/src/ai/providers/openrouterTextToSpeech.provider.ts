import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { secretsManager } from '../../secrets';
import type { AIProviderDescriptor } from '../types/descriptor';
import { AIProviderError, TextToSpeechRequest, TextToSpeechProvider } from '../types';
import { OpenAITextToSpeechProvider } from './openaiTextToSpeech.provider';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'fish-audio/s2.1-pro-free:free';

export class OpenRouterTextToSpeechProvider extends OpenAITextToSpeechProvider {
  override synthesize(request: TextToSpeechRequest) {
    if (request.format && request.format !== 'mp3') {
      throw new AIProviderError(
        'OpenRouter Fish Audio TTS supports mp3 output through Synora.',
        this.id
      );
    }
    return super.synthesize(request);
  }
}

/** OpenRouter's documented audio/speech route is OpenAI SDK compatible. */
export const openrouterTextToSpeechDescriptor: AIProviderDescriptor<TextToSpeechProvider> = {
  id: 'openrouter',
  displayName: 'OpenRouter Text-to-Speech',
  capabilities: ['text-to-speech'],
  metering: 'metered',
  async isConfigured() {
    return secretsManager.hasReal('OPENROUTER_API_KEY', 'ai:openrouter');
  },
  async create() {
    const apiKey = await secretsManager.get('OPENROUTER_API_KEY', 'ai:openrouter');
    return new OpenRouterTextToSpeechProvider(
      'openrouter',
      new OpenAI({ ...SDK_CLIENT_OPTIONS, apiKey, baseURL: OPENROUTER_BASE_URL }),
      DEFAULT_MODEL
    );
  },
};
