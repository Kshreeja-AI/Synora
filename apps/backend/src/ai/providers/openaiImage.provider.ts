import OpenAI from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from '../types';
import type { AIProviderDescriptor } from '../types/descriptor';

const DEFAULT_SIZE = '1024x1024';

/**
 * OpenAI image generation (gpt-image-1 / DALL·E 3) via the official SDK,
 * which is already a dependency. Requests base64 output (`response_format`
 * is implicit for gpt-image-1, explicit for dall-e) so Synora receives the
 * raw bytes and stores them in its own object storage rather than handing
 * back a provider-hosted URL that expires within the hour.
 */
export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly capabilities: readonly AICapability[] = ['image-generation'];

  constructor(
    readonly id: string,
    private readonly client: OpenAI,
    private readonly defaultModel: string
  ) {}

  async generateImages(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const model = request.model ?? this.defaultModel;
    const size = request.size ?? DEFAULT_SIZE;
    const [width, height] = this.parseSize(size);

    try {
      const response = await this.client.images.generate({
        model,
        prompt: request.prompt,
        n: request.count ?? 1,
        size: size as OpenAI.ImageGenerateParams['size'],
      });

      const data = response.data ?? [];
      const images = data
        .map((item) => item.b64_json)
        .filter((b64): b64 is string => typeof b64 === 'string' && b64.length > 0)
        .map((b64) => ({ base64: b64, mimeType: 'image/png', width, height }));

      if (images.length === 0) {
        throw new AIProviderError(
          `${this.id} returned no image data`,
          this.id
        );
      }

      return { images, provider: this.id, model };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `${this.id} image generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }

  private parseSize(size: string): [number, number] {
    const match = size.match(/^(\d+)x(\d+)$/);
    if (!match) {
      throw new AIProviderError(`Invalid image size "${size}" (expected e.g. 1024x1024)`, this.id);
    }
    return [parseInt(match[1], 10), parseInt(match[2], 10)];
  }
}

export const openaiImageDescriptor: AIProviderDescriptor<ImageGenerationProvider> = {
  id: 'openai',
  displayName: 'OpenAI Images',
  capabilities: ['image-generation'],
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('OPENAI_API_KEY', 'ai:openai-image');
  },
  async create() {
    const apiKey = await secretsManager.get('OPENAI_API_KEY', 'ai:openai-image');
    return new OpenAIImageProvider('openai', new OpenAI({ apiKey }), getConfig().ai.openaiImageModel);
  },
};
