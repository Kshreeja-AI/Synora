import { environment, EnvironmentAdapter } from '../environment/environmentAdapter';
import { ProviderName } from '../interfaces/provider';
import { IImageProvider } from '../interfaces/image';
import { IVideoProvider } from '../interfaces/video';
import { IAudioProvider } from '../interfaces/audio';
import { MockImageProvider, MockVideoProvider, MockAudioProvider } from '../mock';
import { OpenAIProvider } from '../../integrations/openai/openaiProvider';
import { AnthropicProvider } from '../../integrations/anthropic/anthropicProvider';
import { ReplicateProvider } from '../../integrations/replicate/replicateProvider';
import { RunwayMLProvider } from '../../integrations/runway/runwayProvider';
import { SynthesiaProvider } from '../../integrations/synthesia/synthesiaProvider';

export interface ProviderSet {
  image: IImageProvider[];
  video: IVideoProvider[];
  audio: IAudioProvider[];
}

/**
 * The only place in the application that knows the full list of concrete
 * providers. Everything downstream (registries, services, routes) only
 * ever sees the Synora capability interfaces.
 *
 * When USE_MOCK_PROVIDERS is set, every provider slot is served by a mock
 * implementation instead — same names, same interfaces, no network calls
 * and no API keys required. This is how the whole application runs in
 * development/CI without depending on any specific AI provider.
 */
export class ProviderFactory {
  constructor(private readonly env: EnvironmentAdapter = environment) {}

  create(): ProviderSet {
    if (this.env.isMockMode()) {
      return this.createMockSet();
    }
    return this.createLiveSet();
  }

  private createMockSet(): ProviderSet {
    return {
      image: [
        new MockImageProvider(ProviderName.OPENAI),
        new MockImageProvider(ProviderName.ANTHROPIC),
        new MockImageProvider(ProviderName.REPLICATE),
      ],
      video: [
        new MockVideoProvider(ProviderName.RUNWAY),
        new MockVideoProvider(ProviderName.SYNTHESIA),
      ],
      audio: [new MockAudioProvider(ProviderName.OPENAI)],
    };
  }

  private createLiveSet(): ProviderSet {
    // OpenAI backs both image and audio capabilities off a single key,
    // so the same instance is registered in both registries.
    const openai = new OpenAIProvider();

    return {
      image: [openai, new AnthropicProvider(), new ReplicateProvider()],
      video: [new RunwayMLProvider(), new SynthesiaProvider()],
      audio: [openai],
    };
  }
}
