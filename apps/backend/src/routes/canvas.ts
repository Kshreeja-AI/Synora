import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import {
  addBlock,
  archiveCanvas,
  createCanvas,
  getCanvas,
  listCanvases,
  persistCanvas,
  removeBlock,
  renameCanvas,
  updateBlock,
} from '../canvas/canvas-store';
import { CANVAS_LIMITS } from '../canvas/types';

/**
 * The canvas HTTP surface.
 *
 * Shaped like the agent and workflow routes on purpose — same workspace
 * guard, same 404-not-403 discipline, same write-through-before-responding
 * so a 201 means durable rather than merely present.
 *
 * The store's own validation messages are surfaced as 400s verbatim
 * because they name the actual problem ("a block outside the surface
 * cannot be found again"), and a caller who placed a block badly is better
 * served by that than by "invalid block".
 */

const router: ExpressRouter = Router({ mergeParams: true });

const blockSchema = z.object({
  kind: z.enum(['text', 'note', 'link']),
  content: z.string().max(CANVAS_LIMITS.maxContentLength),
  target: z.enum(['conversation', 'run', 'workflow', 'agent']).optional(),
  targetId: z.string().max(200).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const blockUpdateSchema = z.object({
  content: z.string().max(CANVAS_LIMITS.maxContentLength).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

function toHttpError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'canvas not found') return new NotFoundException('Canvas');
  if (message === 'block not found') return new NotFoundException('Block');
  if (
    message.includes('needs a title') ||
    message.includes('exceeds') ||
    message.includes('unknown block kind') ||
    message.includes('must name what it points at') ||
    message.includes('only a link block') ||
    message.includes('cannot be found again') ||
    message.includes('at most') ||
    message.includes('must be between')
  ) {
    return new ValidationException(message);
  }
  return err;
}

router.use('/:workspaceId/canvases', authMiddleware, requireWorkspaceAccess());

router.get('/:workspaceId/canvases', async (req: AuthRequest, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    res.json(createApiResponse(listCanvases(req.params.workspaceId, { includeArchived })));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/canvases', async (req: AuthRequest, res, next) => {
  try {
    const { title } = z.object({ title: z.string().min(1).max(CANVAS_LIMITS.maxTitleLength) }).parse(req.body);
    const canvas = createCanvas({
      workspaceId: req.params.workspaceId,
      title,
      createdBy: req.userId!,
    });
    await persistCanvas(canvas.id);
    res.status(201).json(createApiResponse(canvas));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.get('/:workspaceId/canvases/:canvasId', async (req: AuthRequest, res, next) => {
  try {
    const canvas = getCanvas(req.params.canvasId, req.params.workspaceId);
    if (!canvas) return next(new NotFoundException('Canvas'));
    res.json(createApiResponse(canvas));
  } catch (error) {
    next(error);
  }
});

router.patch('/:workspaceId/canvases/:canvasId', async (req: AuthRequest, res, next) => {
  try {
    const { title } = z.object({ title: z.string().min(1).max(CANVAS_LIMITS.maxTitleLength) }).parse(req.body);
    const canvas = renameCanvas(req.params.canvasId, req.params.workspaceId, title);
    await persistCanvas(canvas.id);
    res.json(createApiResponse(canvas));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.delete('/:workspaceId/canvases/:canvasId', async (req: AuthRequest, res, next) => {
  try {
    const canvas = archiveCanvas(req.params.canvasId, req.params.workspaceId);
    await persistCanvas(canvas.id);
    res.json(createApiResponse(canvas));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.post('/:workspaceId/canvases/:canvasId/blocks', async (req: AuthRequest, res, next) => {
  try {
    const body = blockSchema.parse(req.body);
    const block = addBlock(req.params.canvasId, req.params.workspaceId, body);
    await persistCanvas(req.params.canvasId);
    res.status(201).json(createApiResponse(block));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.patch(
  '/:workspaceId/canvases/:canvasId/blocks/:blockId',
  async (req: AuthRequest, res, next) => {
    try {
      const body = blockUpdateSchema.parse(req.body);
      const block = updateBlock(
        req.params.canvasId,
        req.params.workspaceId,
        req.params.blockId,
        body,
      );
      await persistCanvas(req.params.canvasId);
      res.json(createApiResponse(block));
    } catch (error) {
      next(toHttpError(error));
    }
  },
);

router.delete(
  '/:workspaceId/canvases/:canvasId/blocks/:blockId',
  async (req: AuthRequest, res, next) => {
    try {
      const removed = removeBlock(
        req.params.canvasId,
        req.params.workspaceId,
        req.params.blockId,
      );
      if (!removed) return next(new NotFoundException('Block'));
      await persistCanvas(req.params.canvasId);
      res.json(createApiResponse({ deleted: true }));
    } catch (error) {
      next(toHttpError(error));
    }
  },
);

export default router;
