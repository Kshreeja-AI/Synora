import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  TextToSpeechProvider,
  TextToSpeechRequest,
  TextToSpeechResult,
} from '../types';
import type { AIProviderDescriptor } from '../types/descriptor';

const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'mp3';

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

/**
 * OpenAI text-to-speech via the official SDK (already a dependency for
 * text/image generation). `audio.speech.create` returns a fetch-style
 * `Response`; Synora reads the raw bytes and stores them in its own object
 * storage rather than re-serving whatever OpenAI returned inline.
 */
export class OpenAITextToSpeechProvider implements TextToSpeechProvider {
  readonly capabilities: readonly AICapability[] = ['text-to-speech'];

  constructor(
    readonly id: string,
    private readonly client: OpenAI,
    private readonly defaultModel: string,
    private readonly defaultVoice: string
  ) {}

  async synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult> {
    const model = request.model ?? this.defaultModel;
    const voice = request.voice ?? this.defaultVoice;
    const format = request.format ?? DEFAULT_FORMAT;

    try {
      const response = await this.client.audio.speech.create({
        model,
        voice,
        input: request.text,
        response_format: format as OpenAI.Audio.SpeechCreateParams['response_format'],
      });

      const audio = Buffer.from(await response.arrayBuffer());

      if (audio.length === 0) {
        throw new AIProviderError(`${this.id} returned no audio data`, this.id);
      }

      return {
        audio,
        mimeType: MIME_TYPES[format] ?? 'application/octet-stream',
        provider: this.id,
        model,
        voice,
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `${this.id} text-to-speech failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const openaiTextToSpeechDescriptor: AIProviderDescriptor<TextToSpeechProvider> = {
  id: 'openai',
  displayName: 'OpenAI Text-to-Speech',
  capabilities: ['text-to-speech'],
  async isConfigured() {
    return (await secretsManager.tryGet('OPENAI_API_KEY', 'ai:openai-tts')) !== undefined;
  },
  async create() {
    const apiKey = await secretsManager.get('OPENAI_API_KEY', 'ai:openai-tts');
    const config = getConfig();
    return new OpenAITextToSpeechProvider(
      'openai',
      new OpenAI({ apiKey }),
      config.ai.openaiTtsModel,
      config.ai.openaiTtsVoice
    );
  },
};
