import { IProvider } from './provider';

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

export interface IVideoProvider extends IProvider {
  generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<VideoGenerationResult>;
}
