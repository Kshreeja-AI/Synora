import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import {
  createWorkspace,
  listWorkspacesForUser,
  getWorkspaceForUser,
  updateWorkspace,
  listWorkspaceMembers,
} from '../services/workspace.service';

const router: Router = Router();

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const workspaces = await listWorkspacesForUser(req.userId!);
    res.json(createApiResponse(workspaces));
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = createWorkspaceSchema.parse(req.body);
    const workspace = await createWorkspace(req.userId!, input);
    res.status(201).json(createApiResponse(workspace));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getWorkspaceForUser(req.userId!, req.params.id);
    res.json(createApiResponse(workspace));
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = updateWorkspaceSchema.parse(req.body);
    const workspace = await updateWorkspace(req.userId!, req.params.id, input);
    res.json(createApiResponse(workspace));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/members', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const members = await listWorkspaceMembers(req.userId!, req.params.id);
    res.json(createApiResponse(members));
  } catch (error) {
    next(error);
  }
});

export default router;
