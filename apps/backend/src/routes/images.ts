import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import { aiService } from '../services/aiService';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

const generateImageSchema = z.object({
  prompt: z.string().min(10).max(1000),
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
  provider: z.enum(['openai', 'replicate', 'anthropic']).optional(),
  projectId: z.string().optional(),
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

router.post('/generate', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { prompt, width, height, provider, projectId } = generateImageSchema.parse(req.body);

    // Create placeholder record first
    const image = await prisma.generatedImage.create({
      data: {
        userId: req.userId!,
        prompt,
        width: width || 1024,
        height: height || 1024,
        imageUrl: 'https://via.placeholder.com/300x300?text=Generating...',
        model: provider || 'openai',
        status: 'PROCESSING',
        projectId,
      },
    });

    // Generate image asynchronously
    (async () => {
      try {
        const result = await aiService.generateImage(prompt, {
          width: width || 1024,
          height: height || 1024,
          provider,
        });

        // Update with actual result
        await prisma.generatedImage.update({
          where: { id: image.id },
          data: {
            imageUrl: result.url,
            thumbnailUrl: result.thumbnailUrl,
            status: 'COMPLETED',
          },
        });

        logger.info('Image generation completed', { imageId: image.id, prompt });
      } catch (error) {
        await prisma.generatedImage.update({
          where: { id: image.id },
          data: { status: 'FAILED' },
        });

        logger.error('Image generation failed', { imageId: image.id, error });
      }
    })();

    res.status(201).json(createApiResponse(image));
  } catch (error) {
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
