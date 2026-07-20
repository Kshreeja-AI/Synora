import { IProvider } from './provider';

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

export interface IImageProvider extends IProvider {
  generateImage(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult>;
}
