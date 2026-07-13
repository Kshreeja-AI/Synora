import { logger } from '../utils/logger';

export interface VideoGenerationOptions {
  duration?: number;
  fps?: number;
  format?: 'mp4' | 'webm';
  quality?: 'low' | 'medium' | 'high';
}

export interface VideoGenerationResult {
  url: string;
  thumbnailUrl?: string;
  duration: number;
  width: number;
  height: number;
  format: string;
  model: string;
}

export interface VideoProvider {
  name: string;
  generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<VideoGenerationResult>;
}

// Runway ML Provider
export class RunwayMLProvider implements VideoProvider {
  name = 'runway';
  private apiKey: string;
  private apiUrl = 'https://api.runwayml.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.RUNWAYML_API_KEY || '';
  }

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationResult> {
    if (!this.apiKey) {
      throw new Error('Runway ML API key not configured');
    }

    try {
      const response = await fetch(`${this.apiUrl}/image_to_video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          duration: options?.duration || 4,
          fps: options?.fps || 24,
          format: options?.format || 'mp4',
        }),
      });

      if (!response.ok) {
        throw new Error(`Runway ML API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        url: data.video_url,
        thumbnailUrl: data.thumbnail_url,
        duration: options?.duration || 4,
        width: 1280,
        height: 720,
        format: options?.format || 'mp4',
        model: 'runway-gen2',
      };
    } catch (error) {
      logger.error('Video generation failed', { error, prompt });
      throw error;
    }
  }
}

// Synthesia Provider (AI Avatar Video)
export class SynthesiaProvider implements VideoProvider {
  name = 'synthesia';
  private apiKey: string;
  private apiUrl = 'https://api.synthesia.io/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.SYNTHESIA_API_KEY || '';
  }

  async generateVideo(
    prompt: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationResult> {
    if (!this.apiKey) {
      throw new Error('Synthesia API key not configured');
    }

    try {
      // First create a video with AI avatar speaking the prompt
      const createResponse = await fetch(`${this.apiUrl}/videos`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Generated Avatar Video',
          script: {
            type: 'text',
            input: prompt,
          },
          avatar: {
            type: 'full_body',
            choice: 'maya',
          },
          background: {
            type: 'color',
            color: '#FFFFFF',
          },
        }),
      });

      if (!createResponse.ok) {
        throw new Error(`Synthesia API error: ${createResponse.statusText}`);
      }

      const data = await createResponse.json();

      return {
        url: data.download_url || `https://synthesia.io/videos/${data.id}`,
        duration: options?.duration || 10,
        width: 1280,
        height: 720,
        format: 'mp4',
        model: 'synthesia-avatar',
      };
    } catch (error) {
      logger.error('Avatar video generation failed', { error, prompt });
      throw error;
    }
  }
}

// Video Service Factory
export class VideoService {
  private providers: Map<string, VideoProvider> = new Map();
  private defaultProvider: string = 'runway';

  constructor() {
    this.providers.set('runway', new RunwayMLProvider());
    this.providers.set('synthesia', new SynthesiaProvider());

    logger.info('Video Service initialized', {
      providers: Array.from(this.providers.keys()),
    });
  }

  getProvider(name?: string): VideoProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Video provider not found: ${providerName}`);
    }

    return provider;
  }

  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Video provider not available: ${name}`);
    }
    this.defaultProvider = name;
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
