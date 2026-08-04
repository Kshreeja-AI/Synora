import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ServiceUnavailableException } from '@synora/shared';
import { NoProviderConfiguredError } from '../ai';
import { imageGenerationService } from '../services/imageGeneration.service';
import { getProjectForUser } from '../services/project.service';
import { mediaGenerationLimiter } from '../middleware/resourceRateLimit.js';

const router: Router = Router();

// OpenAI's image models accept a fixed set of square/portrait/landscape
// sizes; we accept a `${w}x${h}` string and let the provider reject
// unsupported combinations rather than inventing arbitrary dimensions.
const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  size: z
    .string()
    .regex(/^\d{2,4}x\d{2,4}$/, 'size must look like 1024x1024')
    .optional(),
  projectId: z.string().min(1).optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const images = await prisma.generatedImage.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(createApiResponse(images));
  } catch (error) {
    next(error);
  }
});

router.post('/generate', authMiddleware, mediaGenerationLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { prompt, size, projectId } = generateImageSchema.parse(req.body);

    // The project timeline is read by bare projectId, so an unchecked id
    // here would let anyone plant generated media in a project — and
    // therefore a workspace — they cannot see. 404 on any project the
    // caller can't access.
    if (projectId) {
      await getProjectForUser(req.userId!, projectId);
    }

    const image = await imageGenerationService.generate({
      userId: req.userId!,
      prompt,
      size,
      projectId,
    });

    res.status(201).json(createApiResponse(image));
  } catch (error) {
    // No image provider configured: honest 503, not a fabricated image.
    if (error instanceof NoProviderConfiguredError) {
      next(
        new ServiceUnavailableException(
          'Image generation is not available: no image provider is configured for this deployment.'
        )
      );
      return;
    }
    next(error);
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const image = await prisma.generatedImage.findUnique({
      where: { id: req.params.id },
    });

    if (!image || image.userId !== req.userId) {
      throw new NotFoundException('Image');
    }

    res.json(createApiResponse(image));
  } catch (error) {
    next(error);
  }
});

export default router;
