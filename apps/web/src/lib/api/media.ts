import { api } from './client';

/**
 * Client for the three media generation backends.
 *
 * Note the asymmetry, which is real and not worth hiding: image and audio
 * generation are synchronous (201 with a finished record), video generation
 * is asynchronous (202 with a PROCESSING record that a worker finishes
 * later). The video hook therefore polls; the other two do not.
 *
 * When a deployment has no provider configured for a medium, the backend
 * answers 503 rather than fabricating output. The UI surfaces that verbatim.
 */

/** Mirrors the Prisma `ContentStatus` enum. */
export type ContentStatus = 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PUBLISHED';

export const TERMINAL_STATUSES: ContentStatus[] = ['COMPLETED', 'FAILED', 'PUBLISHED'];

export function isTerminal(status: ContentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface GeneratedImage {
  id: string;
  userId: string;
  projectId: string | null;
  prompt: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  model: string;
  status: ContentStatus;
  createdAt: string;
}

export interface GeneratedVideo {
  id: string;
  userId: string;
  projectId: string | null;
  prompt: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  duration: number;
  width: number;
  height: number;
  model: string;
  status: ContentStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface GeneratedAudio {
  id: string;
  userId: string;
  projectId: string | null;
  prompt: string;
  audioUrl: string;
  duration: number;
  model: string;
  status: ContentStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface GenerateImageInput {
  prompt: string;
  /** `${width}x${height}`; the provider rejects sizes it does not support. */
  size?: string;
  projectId?: string;
}

export interface GenerateVideoInput {
  prompt: string;
  /** Seconds, 1–60 per the backend schema. */
  duration?: number;
  size?: string;
  projectId?: string;
}

export interface GenerateAudioInput {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac';
  projectId?: string;
}

export function listImages(): Promise<GeneratedImage[]> {
  return api.get<GeneratedImage[]>('/api/images');
}

export function getImage(id: string): Promise<GeneratedImage> {
  return api.get<GeneratedImage>(`/api/images/${id}`);
}

export function generateImage(input: GenerateImageInput): Promise<GeneratedImage> {
  return api.post<GeneratedImage>('/api/images/generate', input);
}

export function listVideos(): Promise<GeneratedVideo[]> {
  return api.get<GeneratedVideo[]>('/api/videos');
}

export function getVideo(id: string): Promise<GeneratedVideo> {
  return api.get<GeneratedVideo>(`/api/videos/${id}`);
}

export function generateVideo(input: GenerateVideoInput): Promise<GeneratedVideo> {
  return api.post<GeneratedVideo>('/api/videos/generate', input);
}

export function listAudio(): Promise<GeneratedAudio[]> {
  return api.get<GeneratedAudio[]>('/api/audio');
}

export function getAudio(id: string): Promise<GeneratedAudio> {
  return api.get<GeneratedAudio>(`/api/audio/${id}`);
}

export function generateAudio(input: GenerateAudioInput): Promise<GeneratedAudio> {
  return api.post<GeneratedAudio>('/api/audio/generate', input);
}
