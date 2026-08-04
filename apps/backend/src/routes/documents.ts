import { Router } from 'express';
import { z } from 'zod';
import { prisma, DocumentFormat } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException } from '@synora/shared';
import { getProjectForUser } from '../services/project.service';

const router: Router = Router();

/**
 * A document is readable by its owner, always — and additionally by
 * anyone who can see the project it is filed into.
 *
 * This isn't a new sharing decision: `projectWorkspace.service.ts`
 * already lists every document filed into a workspace project — title
 * and timestamp — to any member of that workspace, and the project
 * panel links straight to `/documents/:id`. Without this, that link
 * would 404 for everyone except the document's own creator, which is a
 * broken product surface, not a permission boundary anyone intended.
 *
 * `getProjectForUser` is the single source of truth for "can this user
 * see this project" (workspace membership, or personal ownership) — a
 * document filed into someone else's *personal* project can never reach
 * this path in the first place, because filing requires that same check
 * at write time.
 */
async function canReadDocument(
  userId: string,
  document: { userId: string; projectId: string | null }
): Promise<boolean> {
  if (document.userId === userId) return true;
  if (!document.projectId) return false;
  try {
    await getProjectForUser(userId, document.projectId);
    return true;
  } catch {
    return false;
  }
}

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
    // Deliberately narrower than the single-document GET below: "your
    // documents" means authored-by-you. Documents someone else filed
    // into a shared project are reachable by following that project's
    // timeline, not by widening this list into "everything I can see".
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

    if (!document || !(await canReadDocument(req.userId!, document))) {
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
    // Deliberately narrower than read: being able to see a document
    // through a shared project is not a claim on its author's words.
    // Editing stays owner-only until a real collaboration model exists.
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
