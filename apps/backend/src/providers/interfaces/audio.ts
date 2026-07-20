import { IProvider } from './provider';

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

export interface IAudioProvider extends IProvider {
  generateAudio(prompt: string, options?: AudioGenerationOptions): Promise<AudioGenerationResult>;
}
