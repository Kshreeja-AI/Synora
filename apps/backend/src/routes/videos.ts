import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ServiceUnavailableException } from '@synora/shared';
import { NoProviderConfiguredError } from '../ai';
import { videoGenerationService } from '../services/videoGeneration.service';
import { getProjectForUser } from '../services/project.service';
import { mediaGenerationLimiter } from '../middleware/resourceRateLimit.js';

const router: Router = Router();

const generateVideoSchema = z.object({
  prompt: z.string().min(1).max(4000),
  duration: z.number().int().min(1).max(60).optional(),
  size: z
    .string()
    .regex(/^\d{2,4}x\d{2,4}$/, 'size must look like 1280x720')
    .optional(),
  projectId: z.string().min(1).optional(),
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

router.post('/generate', authMiddleware, mediaGenerationLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { prompt, duration, size, projectId } = generateVideoSchema.parse(req.body);

    // Same rule as images: an unchecked projectId would plant media in a
    // project the caller cannot see. 404 on inaccessible projects.
    if (projectId) {
      await getProjectForUser(req.userId!, projectId);
    }

    const video = await videoGenerationService.startGeneration({
      userId: req.userId!,
      prompt,
      duration,
      size,
      projectId,
    });

    res.status(202).json(createApiResponse(video));
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) {
      next(
        new ServiceUnavailableException(
          'Video generation is not available: no video provider is configured for this deployment.'
        )
      );
      return;
    }
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
