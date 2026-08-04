import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/requireWorkspaceAccess';
import { requirePermission } from '../middleware/requirePermission';
import { createApiResponse } from '@synora/shared';
import { validateIdQuery } from '../middleware/queryValidation';
import {
  createProject,
  listProjectsForUser,
  getProjectForUser,
  updateProject,
  deleteProject,
} from '../services/project.service';
import { getProjectWorkspace } from '../services/projectWorkspace.service';

const router: Router = Router();

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  // What "done" would look like, in the person's words. Optional: nobody
  // should be made to write a goal before they are allowed to start.
  goal: z.string().trim().max(2000).optional(),
  workspaceId: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  goal: z.string().trim().max(2000).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']).optional(),
});

router.get('/', authMiddleware, validateIdQuery, async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    const projects = await listProjectsForUser(req.userId!, workspaceId);
    res.json(createApiResponse(projects));
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = createProjectSchema.parse(req.body);

    // If workspaceId is provided, validate workspace access
    if (input.workspaceId) {
      const { isMember } = await import('../services/checks');
      const canAccess = await isMember(req.userId!, input.workspaceId);
      if (!canAccess) {
        const { NotFoundException } = await import('@synora/shared');
        return next(new NotFoundException('Workspace'));
      }

      // Check permission (uses centralized matrix from services/permissions.ts)
      const { hasPermission } = await import('../services/permissions');
      const { prisma } = await import('@synora/database');
      const membership = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: req.userId!, workspaceId: input.workspaceId } },
        select: { role: true },
      });

      if (!membership || !hasPermission(membership.role, 'project:create')) {
        const { ForbiddenException } = await import('@synora/shared');
        return next(new ForbiddenException('Insufficient permissions to create project'));
      }
    }

    const project = await createProject(req.userId!, input);
    res.status(201).json(createApiResponse(project));
  } catch (error) {
    next(error);
  }
});

router.get('/:projectId', authMiddleware, requireProjectAccess(), async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectForUser(req.userId!, req.params.projectId);
    res.json(createApiResponse(project));
  } catch (error) {
    next(error);
  }
});

/**
 * The project as the work inside it: conversations, files, documents and
 * generated media in one chronology, plus where to pick up.
 *
 * Declared before the `/:projectId` PATCH/DELETE handlers is not required
 * (this is a distinct literal sub-path), but it does need to sit after the
 * bare `/:projectId` GET or Express would never reach it.
 */
router.get(
  '/:projectId/workspace',
  authMiddleware,
  requireProjectAccess(),
  async (req: AuthRequest, res, next) => {
    try {
      res.json(createApiResponse(await getProjectWorkspace(req.userId!, req.params.projectId)));
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:projectId',
  authMiddleware,
  requireProjectAccess(),
  requirePermission('project:update'),
  async (req: AuthRequest, res, next) => {
    try {
      const input = updateProjectSchema.parse(req.body);
      const project = await updateProject(req.userId!, req.params.projectId, input);
      res.json(createApiResponse(project));
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:projectId',
  authMiddleware,
  requireProjectAccess(),
  requirePermission('project:delete'),
  async (req: AuthRequest, res, next) => {
    try {
      await deleteProject(req.userId!, req.params.projectId);
      res.json(createApiResponse({ message: 'Project deleted.' }));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
