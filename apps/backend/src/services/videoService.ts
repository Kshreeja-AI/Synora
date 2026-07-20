import { logger } from '../utils/logger';
import { ProviderContainer, defaultProviderContainer } from '../providers/container';
import { ProviderName } from '../providers/interfaces/provider';
import { IVideoProvider, VideoGenerationOptions, VideoGenerationResult } from '../providers/interfaces/video';

// Concrete providers live in apps/backend/src/integrations/* and are only
// re-exported here for backward compatibility with existing imports.
export { RunwayMLProvider } from '../integrations/runway/runwayProvider';
export { SynthesiaProvider } from '../integrations/synthesia/synthesiaProvider';

export type { VideoGenerationOptions, VideoGenerationResult };

// Video Service Facade — resolves providers through the Synora provider
// abstraction layer instead of hardcoding `new RunwayMLProvider()` etc.,
// so providers are swappable (including mock providers via
// USE_MOCK_PROVIDERS) without any change here.
export class VideoService {
  private readonly container: ProviderContainer;
  private defaultProvider: ProviderName = ProviderName.RUNWAY;

  constructor(container: ProviderContainer = defaultProviderContainer) {
    this.container = container;

    logger.info('Video Service initialized', {
      providers: this.container.videoProviders.names(),
    });
  }

  getProvider(name?: string): IVideoProvider {
    const providerName = (name || this.defaultProvider) as ProviderName;
    const provider = this.container.videoProviders.get(providerName);

    if (!provider) {
      throw new Error(`Video provider not found: ${providerName}`);
    }

    return provider;
  }

  setDefaultProvider(name: string): void {
    if (!this.container.videoProviders.has(name as ProviderName)) {
      throw new Error(`Video provider not available: ${name}`);
    }
    this.defaultProvider = name as ProviderName;
  }

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions & { provider?: string }
  ): Promise<VideoGenerationResult> {
    const providerName = options?.provider;
    const provider = this.getProvider(providerName);
    return provider.generateVideo(prompt, options);
  }
}

export const videoService = new VideoService();
