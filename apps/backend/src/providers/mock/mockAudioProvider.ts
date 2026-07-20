import { logger } from '../../utils/logger';
import { ProviderName } from '../interfaces/provider';
import { IAudioProvider, AudioGenerationOptions, AudioGenerationResult } from '../interfaces/audio';

export class MockAudioProvider implements IAudioProvider {
  constructor(readonly name: ProviderName) {}

  async generateAudio(
    prompt: string,
    _options?: AudioGenerationOptions
  ): Promise<AudioGenerationResult> {
    logger.info('Mock audio generation', { provider: this.name, prompt });

    return {
      url: `https://mock.synora.local/audio/${this.name}/placeholder.mp3`,
      duration: 0,
      model: `mock-${this.name}`,
    };
  }
}
