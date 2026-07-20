import { logger } from '../../utils/logger';
import { secretsManager } from '../../providers/secrets/secretsManager';
import { ProviderName } from '../../providers/interfaces/provider';
import { IVideoProvider, VideoGenerationOptions, VideoGenerationResult } from '../../providers/interfaces/video';

export class SynthesiaProvider implements IVideoProvider {
  readonly name = ProviderName.SYNTHESIA;
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.synthesia.io/v1';

  constructor(apiKey?: string) {
    this.apiKey = secretsManager.resolve(apiKey, 'SYNTHESIA_API_KEY');
  }

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationResult> {
    if (!this.apiKey) {
      throw new Error('Synthesia API key not configured');
    }

    try {
      // First create a video with AI avatar speaking the prompt
      const createResponse = await fetch(`${this.apiUrl}/videos`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Generated Avatar Video',
          script: {
            type: 'text',
            input: prompt,
          },
          avatar: {
            type: 'full_body',
            choice: 'maya',
          },
          background: {
            type: 'color',
            color: '#FFFFFF',
          },
        }),
      });

      if (!createResponse.ok) {
        throw new Error(`Synthesia API error: ${createResponse.statusText}`);
      }

      const data = await createResponse.json();

      return {
        url: data.download_url || `https://synthesia.io/videos/${data.id}`,
        duration: options?.duration || 10,
        width: 1280,
        height: 720,
        format: 'mp4',
        model: 'synthesia-avatar',
      };
    } catch (error) {
      logger.error('Avatar video generation failed', { error, prompt });
      throw error;
    }
  }
}
