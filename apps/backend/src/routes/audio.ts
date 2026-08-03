import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ServiceUnavailableException } from '@synora/shared';
import { NoProviderConfiguredError } from '../ai';
import { audioGenerationService } from '../services/audioGeneration.service';
import { mediaGenerationLimiter } from '../middleware/resourceRateLimit.js';

const router: Router = Router();

const generateAudioSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().min(1).max(100).optional(),
  format: z.enum(['mp3', 'wav', 'ogg', 'flac', 'aac']).optional(),
  projectId: z.string().min(1).optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const audios = await prisma.generatedAudio.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(createApiResponse(audios));
  } catch (error) {
    next(error);
  }
});

router.post('/generate', authMiddleware, mediaGenerationLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { text, voice, format, projectId } = generateAudioSchema.parse(req.body);

    const audio = await audioGenerationService.generate({
      userId: req.userId!,
      text,
      voice,
      format,
      projectId,
    });

    res.status(201).json(createApiResponse(audio));
  } catch (error) {
    // No text-to-speech provider configured: honest 503, not fabricated audio.
    if (error instanceof NoProviderConfiguredError) {
      next(
        new ServiceUnavailableException(
          'Text-to-speech is not available: no audio provider is configured for this deployment.'
        )
      );
      return;
    }
    next(error);
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const audio = await prisma.generatedAudio.findUnique({
      where: { id: req.params.id },
    });

    if (!audio || audio.userId !== req.userId) {
      throw new NotFoundException('Audio');
    }

    res.json(createApiResponse(audio));
  } catch (error) {
    next(error);
  }
});

export default router;
