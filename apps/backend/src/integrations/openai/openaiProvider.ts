import { logger } from '../../utils/logger';
import { secretsManager } from '../../providers/secrets/secretsManager';
import { ProviderName } from '../../providers/interfaces/provider';
import { IImageProvider, ImageGenerationOptions, ImageGenerationResult } from '../../providers/interfaces/image';
import { IAudioProvider, AudioGenerationOptions, AudioGenerationResult } from '../../providers/interfaces/audio';

/**
 * OpenAI integration: implements both the image and audio capability
 * interfaces, since a single OpenAI account/key backs both DALL-E and TTS.
 */
export class OpenAIProvider implements IImageProvider, IAudioProvider {
  readonly name = ProviderName.OPENAI;
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = secretsManager.resolve(apiKey, 'OPENAI_API_KEY');
    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured');
    }
  }

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const width = options?.width || 1024;
    const height = options?.height || 1024;

    try {
      const response = await fetch(`${this.apiUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          n: 1,
          size: `${width}x${height}`,
          quality: options?.quality || 'standard',
          model: 'dall-e-3',
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        url: data.data[0].url,
        width,
        height,
        model: 'dall-e-3',
      };
    } catch (error) {
      logger.error('OpenAI image generation failed', { error, prompt });
      throw error;
    }
  }

  async generateAudio(
    prompt: string,
    options?: AudioGenerationOptions
  ): Promise<AudioGenerationResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await fetch(`${this.apiUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: prompt,
          voice: options?.voice || 'alloy',
          speed: options?.speed || 1.0,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI Audio API error: ${response.statusText}`);
      }

      // In real implementation, upload to S3 and return URL
      return {
        url: 'https://s3.amazonaws.com/synora/audio/placeholder.mp3',
        duration: 0,
        model: 'tts-1',
      };
    } catch (error) {
      logger.error('OpenAI audio generation failed', { error, prompt });
      throw error;
    }
  }
}
