import { Router } from 'express';
import { z } from 'zod';
import { prisma, DocumentFormat } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException } from '@synora/shared';

const router: Router = Router();

const createDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(1_000_000),
  format: z.nativeEnum(DocumentFormat).optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(createApiResponse(documents));
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { title, content, format } = createDocumentSchema.parse(req.body);

    const document = await prisma.document.create({
      data: {
        userId: req.userId!,
        title,
        content,
        format: format ?? DocumentFormat.MARKDOWN,
      },
    });

    res.status(201).json(createApiResponse(document));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
    });

    if (!document || document.userId !== req.userId) {
      throw new NotFoundException('Document');
    }

    res.json(createApiResponse(document));
  } catch (error) {
    next(error);
  }
});

export default router;
