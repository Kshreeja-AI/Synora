import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { folderService } from '../services/folder.service';

const router: Router = Router({ mergeParams: true });

const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().optional(),
});

const updateFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

const moveFolderSchema = z.object({
  parentId: z.string().nullable().optional(),
});

const moveConversationSchema = z.object({
  folderId: z.string().nullable().optional(),
});

/**
 * POST /api/workspaces/:workspaceId/folders
 * Create folder
 */
router.post('/:workspaceId/folders', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;
    const input = createFolderSchema.parse(req.body);

    const folder = await folderService.createFolder(req.userId!, workspaceId, input);

    res.status(201).json(createApiResponse(folder));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/workspaces/:workspaceId/folders
 * List all folders with hierarchy
 */
router.get('/:workspaceId/folders', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;

    const folders = await folderService.getFoldersByWorkspace(req.userId!, workspaceId);

    res.json(createApiResponse({ items: folders }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/workspaces/:workspaceId/folders/:folderId
 * Get folder with children
 */
router.get('/:workspaceId/folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params;

    const folder = await folderService.getFolderWithChildren(req.userId!, folderId);

    res.json(createApiResponse(folder));
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/workspaces/:workspaceId/folders/:folderId
 * Update folder name
 */
router.patch('/:workspaceId/folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params;
    const input = updateFolderSchema.parse(req.body);

    const folder = await folderService.updateFolder(req.userId!, folderId, input);

    res.json(createApiResponse(folder));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/workspaces/:workspaceId/folders/:folderId/move
 * Move folder to different parent
 */
router.post('/:workspaceId/folders/:folderId/move', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params;
    const input = moveFolderSchema.parse(req.body);

    const folder = await folderService.moveFolder(req.userId!, folderId, input.parentId || null);

    res.json(createApiResponse(folder));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/folders/:folderId
 * Delete folder (must be empty)
 */
router.delete('/:workspaceId/folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params;

    await folderService.deleteFolder(req.userId!, folderId);

    res.json(createApiResponse({ success: true }));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/workspaces/:workspaceId/conversations/:conversationId/move-to-folder
 * Move conversation to folder
 */
router.post(
  '/:workspaceId/conversations/:conversationId/move-to-folder',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId } = req.params;
      const input = moveConversationSchema.parse(req.body);

      await folderService.moveConversationToFolder(req.userId!, conversationId, input.folderId || null);

      res.json(createApiResponse({ success: true }));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
