import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ForbiddenException } from '@synora/shared';
import { collaborationService } from '../services/collaborationService';

const router = Router();

const addCollaboratorSchema = z.object({
  projectId: z.string(),
  email: z.string().email(),
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER']),
});

const shareSchema = z.object({
  projectId: z.string(),
  expiresIn: z.number().optional(),
});

// Add collaborator to project
router.post('/add', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { projectId, email, role } = addCollaboratorSchema.parse(req.body);

    // Check if user has permission to add collaborators
    const canShare = await collaborationService.checkPermission(
      req.userId!,
      projectId,
      'share'
    );

    if (!canShare) {
      throw new ForbiddenException('You do not have permission to add collaborators');
    }

    const collaborator = await collaborationService.addCollaborator(projectId, email, role);

    // Log activity
    await collaborationService.logActivity(req.userId!, projectId, 'shared', 'collaborator_added');

    res.json(
      createApiResponse({
        message: 'Collaborator added successfully',
        collaborator,
      })
    );
  } catch (error) {
    next(error);
  }
});

// Get project collaborators
router.get('/:projectId/collaborators', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    // Check if user can view
    const canView = await collaborationService.checkPermission(
      req.userId!,
      req.params.projectId,
      'view'
    );

    if (!canView) {
      throw new ForbiddenException('You do not have permission to view this project');
    }

    const collaborators = await collaborationService.getCollaborators(req.params.projectId);

    res.json(createApiResponse(collaborators));
  } catch (error) {
    next(error);
  }
});

// Remove collaborator
router.post('/remove', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { projectId, userId } = z
      .object({
        projectId: z.string(),
        userId: z.string(),
      })
      .parse(req.body);

    // Check if user has permission
    const canShare = await collaborationService.checkPermission(
      req.userId!,
      projectId,
      'share'
    );

    if (!canShare) {
      throw new ForbiddenException('You do not have permission to manage collaborators');
    }

    const removed = await collaborationService.removeCollaborator(projectId, userId);

    if (!removed) {
      throw new NotFoundException('Collaborator');
    }

    // Log activity
    await collaborationService.logActivity(req.userId!, projectId, 'shared', 'collaborator_removed');

    res.json(createApiResponse({ message: 'Collaborator removed successfully' }));
  } catch (error) {
    next(error);
  }
});

// Get activity history
router.get('/:projectId/activity', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const canView = await collaborationService.checkPermission(
      req.userId!,
      req.params.projectId,
      'view'
    );

    if (!canView) {
      throw new ForbiddenException('You do not have permission to view this project');
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const activity = await collaborationService.getActivityHistory(req.params.projectId, limit);

    res.json(createApiResponse(activity));
  } catch (error) {
    next(error);
  }
});

// Create shareable link
router.post('/share', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { projectId, expiresIn } = shareSchema.parse(req.body);

    const canShare = await collaborationService.checkPermission(
      req.userId!,
      projectId,
      'share'
    );

    if (!canShare) {
      throw new ForbiddenException('You do not have permission to share this project');
    }

    const shareLink = await collaborationService.createShareableLink(projectId, expiresIn);

    // Log activity
    await collaborationService.logActivity(req.userId!, projectId, 'shared', 'project_shared');

    res.json(
      createApiResponse({
        message: 'Shareable link created',
        ...shareLink,
      })
    );
  } catch (error) {
    next(error);
  }
});

// Validate share link
router.get('/validate/:token', async (req, res, next) => {
  try {
    const result = await collaborationService.validateShareLink(req.params.token);

    if (!result.valid) {
      return res.status(400).json(
        createApiResponse({
          message: 'Invalid or expired share link',
          valid: false,
        })
      );
    }

    res.json(
      createApiResponse({
        message: 'Share link is valid',
        projectId: result.projectId,
        valid: true,
      })
    );
  } catch (error) {
    next(error);
  }
});

export default router;
