import { Router } from 'express';
import { z } from 'zod';
import { prisma, DocumentFormat } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException } from '@synora/shared';
import { getProjectForUser } from '../services/project.service';

const router: Router = Router();

const createDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(1_000_000),
  format: z.nativeEnum(DocumentFormat).optional(),
  projectId: z.string().min(1).optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(createApiResponse(documents));
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { title, content, format, projectId } = createDocumentSchema.parse(req.body);

    // A project id is a claim of access, not just a foreign key. The
    // project timeline is read by bare projectId, so filing into a
    // project the caller cannot see would plant this document in another
    // workspace's project view. 404, never 403, when the claim fails.
    if (projectId) {
      await getProjectForUser(req.userId!, projectId);
    }

    const document = await prisma.document.create({
      data: {
        userId: req.userId!,
        title,
        content,
        format: format ?? DocumentFormat.MARKDOWN,
        projectId,
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
