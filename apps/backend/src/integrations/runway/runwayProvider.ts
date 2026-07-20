import { logger } from '../../utils/logger';
import { secretsManager } from '../../providers/secrets/secretsManager';
import { ProviderName } from '../../providers/interfaces/provider';
import { IVideoProvider, VideoGenerationOptions, VideoGenerationResult } from '../../providers/interfaces/video';

export class RunwayMLProvider implements IVideoProvider {
  readonly name = ProviderName.RUNWAY;
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.runwayml.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = secretsManager.resolve(apiKey, 'RUNWAYML_API_KEY');
  }

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationResult> {
    if (!this.apiKey) {
      throw new Error('Runway ML API key not configured');
    }

    try {
      const response = await fetch(`${this.apiUrl}/image_to_video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          duration: options?.duration || 4,
          fps: options?.fps || 24,
          format: options?.format || 'mp4',
        }),
      });

      if (!response.ok) {
        throw new Error(`Runway ML API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        url: data.video_url,
        thumbnailUrl: data.thumbnail_url,
        duration: options?.duration || 4,
        width: 1280,
        height: 720,
        format: options?.format || 'mp4',
        model: 'runway-gen2',
      };
    } catch (error) {
      logger.error('Video generation failed', { error, prompt });
      throw error;
    }
  }
}
