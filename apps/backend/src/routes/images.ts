import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException } from '@synora/shared';

const router: Router = Router();
const prisma = new PrismaClient();

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
    const { prompt, width, height, projectId } = req.body;

    const image = await prisma.generatedImage.create({
      data: {
        userId: req.userId!,
        prompt,
        width: width || 512,
        height: height || 512,
        imageUrl: 'https://via.placeholder.com/' + (width || 512) + 'x' + (height || 512),
        model: 'placeholder',
        status: 'COMPLETED',
        projectId,
      },
    });

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
