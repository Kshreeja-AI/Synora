import { logger } from '../utils/logger';

export interface AIProvider {
  name: string;
  generateImage(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult>;
  generateVideo?(prompt: string, options?: VideoGenerationOptions): Promise<VideoGenerationResult>;
  generateAudio?(prompt: string, options?: AudioGenerationOptions): Promise<AudioGenerationResult>;
}

export interface ImageGenerationOptions {
  width?: number;
  height?: number;
  quality?: 'low' | 'medium' | 'high';
  style?: string;
}

export interface ImageGenerationResult {
  url: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  model: string;
}

export interface VideoGenerationOptions {
  duration?: number;
  fps?: number;
  format?: string;
}

export interface VideoGenerationResult {
  url: string;
  thumbnailUrl?: string;
  duration: number;
  width: number;
  height: number;
  model: string;
}

export interface AudioGenerationOptions {
  voice?: string;
  speed?: number;
  format?: string;
}

export interface AudioGenerationResult {
  url: string;
  duration: number;
  model: string;
}

// OpenAI Provider
export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private apiKey: string;
  private apiUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured');
    }
  }

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const width = options?.width || 1024;
    const height = options?.height || 1024;

    try {
      const response = await fetch(`${this.apiUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          n: 1,
          size: `${width}x${height}`,
          quality: options?.quality || 'standard',
          model: 'dall-e-3',
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        url: data.data[0].url,
        width,
        height,
        model: 'dall-e-3',
      };
    } catch (error) {
      logger.error('OpenAI image generation failed', { error, prompt });
      throw error;
    }
  }

  async generateAudio(
    prompt: string,
    options?: AudioGenerationOptions
  ): Promise<AudioGenerationResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await fetch(`${this.apiUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: prompt,
          voice: options?.voice || 'alloy',
          speed: options?.speed || 1.0,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI Audio API error: ${response.statusText}`);
      }

      // In real implementation, upload to S3 and return URL
      return {
        url: 'https://s3.amazonaws.com/synora/audio/placeholder.mp3',
        duration: 0,
        model: 'tts-1',
      };
    } catch (error) {
      logger.error('OpenAI audio generation failed', { error, prompt });
      throw error;
    }
  }
}

// Anthropic Provider (for text-to-image via Replicate)
export class AnthropicProvider implements AIProvider {
  name = 'anthropic';
  private apiKey: string;
  private apiUrl = 'https://api.anthropic.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
  }

  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    // Anthropic focuses on text generation, so we delegate image generation
    // to Replicate using their API
    const replicateProvider = new ReplicateProvider();
    return replicateProvider.generateImage(prompt, options);
  }
}

// Replicate Provider
export class ReplicateProvider implements AIProvider {
  name = 'replicate';
  private apiKey: string;
  private apiUrl = 'https://api.replicate.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.REPLICATE_API_KEY || '';
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

// AI Service Factory
export class AIService {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider: string = 'openai';

  constructor() {
    // Initialize available providers
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('anthropic', new AnthropicProvider());
    this.providers.set('replicate', new ReplicateProvider());

    logger.info('AI Service initialized', {
      providers: Array.from(this.providers.keys()),
    });
  }

  getProvider(name?: string): AIProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`AI provider not found: ${providerName}`);
    }

    return provider;
  }

  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`AI provider not available: ${name}`);
    }
    this.defaultProvider = name;
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
    const provider = this.getProvider(providerName);

    if (!provider.generateVideo) {
      throw new Error(`${provider.name} does not support video generation`);
    }

    return provider.generateVideo(prompt, options);
  }
}

export const aiService = new AIService();
