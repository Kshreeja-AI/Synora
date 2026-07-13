import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import { videoService } from '../services/videoService';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

const generateVideoSchema = z.object({
  prompt: z.string().min(10).max(1000),
  duration: z.number().int().min(1).max(60).optional(),
  fps: z.number().int().min(24).max(60).optional(),
  format: z.enum(['mp4', 'webm']).optional(),
  provider: z.enum(['runway', 'synthesia']).optional(),
  projectId: z.string().optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const videos = await prisma.generatedVideo.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(createApiResponse(videos));
  } catch (error) {
    next(error);
  }
});

router.post('/generate', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { prompt, duration, fps, format, provider, projectId } = generateVideoSchema.parse(
      req.body
    );

    // Create placeholder record
    const video = await prisma.generatedVideo.create({
      data: {
        userId: req.userId!,
        prompt,
        videoUrl: 'https://via.placeholder.com/1280x720?text=Generating+Video...',
        duration: duration || 4,
        width: 1280,
        height: 720,
        model: provider || 'runway',
        status: 'PROCESSING',
        projectId,
      },
    });

    // Generate video asynchronously
    (async () => {
      try {
        const result = await videoService.generateVideo(prompt, {
          duration: duration || 4,
          fps: fps || 24,
          format: (format as 'mp4' | 'webm') || 'mp4',
          provider,
        });

        // Update with actual result
        await prisma.generatedVideo.update({
          where: { id: video.id },
          data: {
            videoUrl: result.url,
            thumbnailUrl: result.thumbnailUrl,
            duration: result.duration,
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        logger.info('Video generation completed', { videoId: video.id, prompt });
      } catch (error) {
        await prisma.generatedVideo.update({
          where: { id: video.id },
          data: { status: 'FAILED' },
        });

        logger.error('Video generation failed', { videoId: video.id, error });
      }
    })();

    res.status(201).json(createApiResponse(video));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const video = await prisma.generatedVideo.findUnique({
      where: { id: req.params.id },
    });

    if (!video || video.userId !== req.userId) {
      throw new NotFoundException('Video');
    }

    res.json(createApiResponse(video));
  } catch (error) {
    next(error);
  }
});

export default router;
