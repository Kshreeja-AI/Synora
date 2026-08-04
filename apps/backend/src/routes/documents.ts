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

// PATCH semantics: an omitted field means "leave it alone"; projectId
// additionally accepts an explicit null meaning "take it out of its
// project" — without that distinction, unfiling would be impossible to
// express.
const updateDocumentSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().max(1_000_000).optional(),
  projectId: z.string().min(1).nullable().optional(),
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

router.patch('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = updateDocumentSchema.parse(req.body);

    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
    });
    if (!document || document.userId !== req.userId) {
      throw new NotFoundException('Document');
    }

    // Same rule as create: a non-null projectId is a claim of access,
    // re-verified every time it changes, not only on first filing.
    if (input.projectId) {
      await getProjectForUser(req.userId!, input.projectId);
    }

    const updated = await prisma.document.update({
      where: { id: document.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.projectId !== undefined && { projectId: input.projectId }),
      },
    });

    res.json(createApiResponse(updated));
  } catch (error) {
    next(error);
  }
});

export default router;
