import { logger } from '../utils/logger';
import { ProviderContainer, defaultProviderContainer } from '../providers/container';
import { ProviderName } from '../providers/interfaces/provider';
import { IImageProvider, ImageGenerationOptions, ImageGenerationResult } from '../providers/interfaces/image';
import { IAudioProvider, AudioGenerationOptions, AudioGenerationResult } from '../providers/interfaces/audio';
import { VideoGenerationOptions, VideoGenerationResult } from '../providers/interfaces/video';

// Concrete providers live in apps/backend/src/integrations/* and are only
// re-exported here for backward compatibility with existing imports/tests.
// New code should depend on the Synora interfaces above, not these classes.
export { OpenAIProvider } from '../integrations/openai/openaiProvider';
export { AnthropicProvider } from '../integrations/anthropic/anthropicProvider';
export { ReplicateProvider } from '../integrations/replicate/replicateProvider';

export type {
  ImageGenerationOptions,
  ImageGenerationResult,
  AudioGenerationOptions,
  AudioGenerationResult,
};

/**
 * A provider as seen by AIService: always supports image generation,
 * optionally supports audio (mirrors the historical AIProvider contract
 * where generateAudio/generateVideo were optional methods).
 */
export type AIProvider = IImageProvider & Partial<IAudioProvider>;

// AI Service Facade — routes/tests depend on this class and its exported
// singleton exactly as before. Internally it now resolves providers through
// the Synora provider abstraction layer instead of hardcoding `new
// OpenAIProvider()` etc., so providers are swappable (including mock
// providers via USE_MOCK_PROVIDERS) without any change here.
export class AIService {
  private readonly container: ProviderContainer;
  private defaultProvider: ProviderName = ProviderName.OPENAI;

  constructor(container: ProviderContainer = defaultProviderContainer) {
    this.container = container;

    logger.info('AI Service initialized', {
      providers: this.container.imageProviders.names(),
    });
  }

  getProvider(name?: string): AIProvider {
    const providerName = (name || this.defaultProvider) as ProviderName;
    const imageProvider = this.container.imageProviders.get(providerName);

    if (!imageProvider) {
      throw new Error(`AI provider not found: ${providerName}`);
    }

    // Image and audio capabilities are resolved independently — a provider
    // may support one, the other, or both (e.g. live OpenAI supports both
    // off a single instance; a mock provider registers a separate instance
    // per capability). Compose them into one legacy-shaped AIProvider so
    // callers can keep doing `provider.generateAudio?.(...)`.
    const audioProvider = this.container.audioProviders.get(providerName);

    return {
      name: providerName,
      generateImage: imageProvider.generateImage.bind(imageProvider),
      generateAudio: audioProvider?.generateAudio.bind(audioProvider),
    };
  }

  setDefaultProvider(name: string): void {
    if (!this.container.imageProviders.has(name as ProviderName)) {
      throw new Error(`AI provider not available: ${name}`);
    }
    this.defaultProvider = name as ProviderName;
  }

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions & { provider?: string }
  ): Promise<ImageGenerationResult> {
    const providerName = options?.provider;
    const provider = this.getProvider(providerName);
    return provider.generateImage(prompt, options);
  }

  async generateAudio(
    prompt: string,
    options?: AudioGenerationOptions & { provider?: string }
  ): Promise<AudioGenerationResult> {
    const providerName = options?.provider;
    const provider = this.getProvider(providerName);

    if (!provider.generateAudio) {
      throw new Error(`${provider.name} does not support audio generation`);
    }

    return provider.generateAudio(prompt, options);
  }

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions & { provider?: string }
  ): Promise<VideoGenerationResult> {
    const providerName = options?.provider;
    const provider = this.getProvider(providerName) as AIProvider & {
      generateVideo?: (p: string, o?: VideoGenerationOptions) => Promise<VideoGenerationResult>;
    };

    if (!provider.generateVideo) {
      throw new Error(`${provider.name} does not support video generation`);
    }

    return provider.generateVideo(prompt, options);
  }
}

export const aiService = new AIService();
