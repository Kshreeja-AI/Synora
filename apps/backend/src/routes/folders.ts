import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { createFolder, listFolders, renameFolder, deleteFolder } from '../services/folder.service';

const router: Router = Router();

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  projectId: z.string().optional(),
  parentId: z.string().optional(),
});

const renameFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

router.get('/:workspaceId/folders', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const parentId =
      req.query.parentId === 'null' ? null : typeof req.query.parentId === 'string' ? req.query.parentId : undefined;
    const folders = await listFolders(req.userId!, req.params.workspaceId, { projectId, parentId });
    res.json(createApiResponse(folders));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/folders', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = createFolderSchema.parse(req.body);
    const folder = await createFolder(req.userId!, req.params.workspaceId, input);
    res.status(201).json(createApiResponse(folder));
  } catch (error) {
    next(error);
  }
});

router.patch('/:workspaceId/folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { name } = renameFolderSchema.parse(req.body);
    const folder = await renameFolder(req.userId!, req.params.workspaceId, req.params.folderId, name);
    res.json(createApiResponse(folder));
  } catch (error) {
    next(error);
  }
});

router.delete('/:workspaceId/folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    await deleteFolder(req.userId!, req.params.workspaceId, req.params.folderId);
    res.json(createApiResponse({ message: 'Folder deleted.' }));
  } catch (error) {
    next(error);
  }
});

export default router;
