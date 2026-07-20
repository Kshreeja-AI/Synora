import { logger } from '../../utils/logger';
import { ProviderName } from '../interfaces/provider';
import { IVideoProvider, VideoGenerationOptions, VideoGenerationResult } from '../interfaces/video';

export class MockVideoProvider implements IVideoProvider {
  constructor(readonly name: ProviderName) {}

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationResult> {
    logger.info('Mock video generation', { provider: this.name, prompt });

    const label = encodeURIComponent(prompt.slice(0, 40));

    return {
      url: `https://mock.synora.local/videos/${this.name}/${label}.mp4`,
      thumbnailUrl: `https://mock.synora.local/videos/${this.name}/${label}-thumb.png`,
      duration: options?.duration || 4,
      width: 1280,
      height: 720,
      format: options?.format || 'mp4',
      model: `mock-${this.name}`,
    };
  }
}
