import { prisma } from '@synora/database';
import type { GeneratedVideo } from '@prisma/client';
import { resolveVideoProvider } from '../ai';
import { resolveStorageProvider } from '../storage';
import { logger } from '../utils/logger';

export interface GenerateVideoInput {
  userId: string;
  prompt: string;
  duration?: number;
  size?: string;
  projectId?: string;
}

export class VideoGenerationService {
  async startGeneration(input: GenerateVideoInput): Promise<GeneratedVideo> {
    const provider = await resolveVideoProvider();

    const pending = await prisma.generatedVideo.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        prompt: input.prompt,
        videoUrl: '',
        duration: input.duration ?? 0,
        width: 0,
        height: 0,
        model: 'pending',
        status: 'PROCESSING',
      },
    });

    try {
      const handle = await provider.startGeneration({
        prompt: input.prompt,
        duration: input.duration,
        size: input.size,
      });

      await prisma.generatedVideo.update({
        where: { id: pending.id },
        data: {
          model: `${handle.provider}:${handle.model}`,
        },
      });

      return await prisma.generatedVideo.findUniqueOrThrow({
        where: { id: pending.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[VideoGeneration] Failed to start generation', {
        videoId: pending.id,
        error: message,
      });
      await prisma.generatedVideo.update({
        where: { id: pending.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  async pollAndFinalize(videoId: string): Promise<GeneratedVideo> {
    const video = await prisma.generatedVideo.findUnique({ where: { id: videoId } });
    if (!video || video.status !== 'PROCESSING') {
      return video!;
    }

    const provider = await resolveVideoProvider();
    const [providerName, modelName] = (video.model || '').split(':');

    const result = await provider.pollJob({
      providerJobId: videoId,
      provider: providerName || provider.id,
      model: modelName || '',
    });

    if (result.status === 'processing' || result.status === 'queued') {
      return video;
    }

    if (result.status === 'failed') {
      return await prisma.generatedVideo.update({
        where: { id: videoId },
        data: { status: 'FAILED' },
      });
    }

    try {
      const videoUrl = result.videoUrl!;
      const buffer = await provider.downloadVideo(videoUrl);
      const storage = await resolveStorageProvider();

      const stored = await storage.upload({
        key: `generated-videos/${video.userId}/${videoId}.mp4`,
        buffer,
        contentType: 'video/mp4',
      });

      return await prisma.generatedVideo.update({
        where: { id: videoId },
        data: {
          videoUrl: stored.url,
          width: result.width ?? 0,
          height: result.height ?? 0,
          duration: result.durationSeconds ?? video.duration,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[VideoGeneration] Storage failed after generation', {
        videoId,
        error: message,
      });
      await prisma.generatedVideo.update({
        where: { id: videoId },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }
}

export const videoGenerationService = new VideoGenerationService();
