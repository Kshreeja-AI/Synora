import { secretsManager } from '../../providers/secrets/secretsManager';
import { ProviderName } from '../../providers/interfaces/provider';
import { IImageProvider, ImageGenerationOptions, ImageGenerationResult } from '../../providers/interfaces/image';
import { ReplicateProvider } from '../replicate/replicateProvider';

/**
 * Anthropic focuses on text generation, so image generation is delegated
 * to the Replicate integration behind the same Synora interface.
 */
export class AnthropicProvider implements IImageProvider {
  readonly name = ProviderName.ANTHROPIC;
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.anthropic.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = secretsManager.resolve(apiKey, 'ANTHROPIC_API_KEY');
  }

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    const replicateProvider = new ReplicateProvider();
    return replicateProvider.generateImage(prompt, options);
  }
}
