import { logger } from '../../utils/logger';
import { secretsManager } from '../../providers/secrets/secretsManager';
import { ProviderName } from '../../providers/interfaces/provider';
import { IImageProvider, ImageGenerationOptions, ImageGenerationResult } from '../../providers/interfaces/image';

export class ReplicateProvider implements IImageProvider {
  readonly name = ProviderName.REPLICATE;
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.replicate.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = secretsManager.resolve(apiKey, 'REPLICATE_API_KEY');
    if (!this.apiKey) {
      logger.warn('Replicate API key not configured');
    }
  }

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    if (!this.apiKey) {
      throw new Error('Replicate API key not configured');
    }

    const width = options?.width || 768;
    const height = options?.height || 768;

    try {
      const response = await fetch(`${this.apiUrl}/predictions`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'a9e6c4b26908d6fbf05db15d23e5481485bbc73d91461a671ca158423ef3612d',
          input: {
            prompt,
            width,
            height,
            num_inference_steps: 50,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Replicate API error: ${response.statusText}`);
      }

      const data = await response.json();

      // Poll for completion
      const prediction = await this.pollPrediction(data.id);

      return {
        url: prediction.output[0],
        width,
        height,
        model: 'stable-diffusion',
      };
    } catch (error) {
      logger.error('Replicate image generation failed', { error, prompt });
      throw error;
    }
  }

  private async pollPrediction(id: string): Promise<any> {
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      const response = await fetch(`${this.apiUrl}/predictions/${id}`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      const data = await response.json();

      if (data.status === 'succeeded') {
        return data;
      }

      if (data.status === 'failed') {
        throw new Error(`Prediction failed: ${data.error}`);
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('Prediction polling timeout');
  }
}
