import { logger } from '../../utils/logger';
import { ProviderName } from '../interfaces/provider';
import { IImageProvider, ImageGenerationOptions, ImageGenerationResult } from '../interfaces/image';

/**
 * Simulates a real image provider without any network call, so development
 * and CI can run with USE_MOCK_PROVIDERS=true and no API keys at all.
 * Registered under the same ProviderName as the real integration it
 * stands in for, so callers see no difference in the provider contract.
 */
export class MockImageProvider implements IImageProvider {
  constructor(readonly name: ProviderName) {}

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    logger.info('Mock image generation', { provider: this.name, prompt });

    const width = options?.width || 1024;
    const height = options?.height || 1024;
    const label = encodeURIComponent(prompt.slice(0, 40));

    return {
      url: `https://mock.synora.local/images/${this.name}/${label}.png`,
      thumbnailUrl: `https://mock.synora.local/images/${this.name}/${label}-thumb.png`,
      width,
      height,
      model: `mock-${this.name}`,
    };
  }
}
