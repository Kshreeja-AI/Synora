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
  // Replicate-class providers take a few seconds just to schedule the job,
  // so the first poll waits longer than the steady-state interval below.
  private readonly INITIAL_POLL_DELAY_MS = 5000;
  // ~15 minutes of polling at the worker's 10s interval before giving up —
  // long enough for real video generation, bounded so a stuck provider job
  // can't keep a row (and a queue slot) PROCESSING forever.
  private readonly MAX_POLL_ATTEMPTS = 90;

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
          // The provider's own job/prediction ID — required to poll this
          // job later. Previously discarded here, which meant polling
          // could never actually find the job again (see pollAndFinalize).
          providerJobId: handle.providerJobId,
        },
      });

      // Dynamic import breaks a circular init: workers/queue.ts imports
      // videoGeneration.worker.ts, which imports this service.
      const { enqueueVideoGeneration } = await import('../workers/queue');
      await enqueueVideoGeneration(
        { videoId: pending.id },
        { delayMs: this.INITIAL_POLL_DELAY_MS }
      );

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

    if (!video.providerJobId) {
      logger.error('[VideoGeneration] Cannot poll: missing providerJobId', { videoId });
      return await prisma.generatedVideo.update({
        where: { id: videoId },
        data: { status: 'FAILED' },
      });
    }

    const provider = await resolveVideoProvider();
    const [providerName, modelName] = (video.model || '').split(':');

    const result = await provider.pollJob({
      providerJobId: video.providerJobId,
      provider: providerName || provider.id,
      model: modelName || '',
    });

    if (result.status === 'processing' || result.status === 'queued') {
      const pollAttempts = video.pollAttempts + 1;
      if (pollAttempts >= this.MAX_POLL_ATTEMPTS) {
        logger.error('[VideoGeneration] Exceeded max poll attempts, marking failed', {
          videoId,
          pollAttempts,
        });
        return await prisma.generatedVideo.update({
          where: { id: videoId },
          data: { status: 'FAILED' },
        });
      }
      return await prisma.generatedVideo.update({
        where: { id: videoId },
        data: { pollAttempts },
      });
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
