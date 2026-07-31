import { Response, NextFunction } from 'express';
import { NotFoundException } from '@synora/shared';
import { isMember } from '../services/checks';
import { AuthRequest } from './auth';
import { logger } from '../utils/logger';

/**
 * Middleware to enforce workspace access control.
 *
 * Extracts workspaceId from req.params.workspaceId and verifies that the
 * user is a member of that workspace before allowing the request to proceed.
 *
 * Returns 404 (not 403) when access is denied — never reveal workspace
 * existence to non-members.
 *
 * Usage:
 *   router.get('/:workspaceId/members', authMiddleware, requireWorkspaceAccess(), handler)
 */
export function requireWorkspaceAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { workspaceId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return next(new NotFoundException('User not authenticated'));
    }

    if (!workspaceId) {
      return next(new NotFoundException('Workspace'));
    }

    try {
      const isMemberResult = await isMember(userId, workspaceId);
      if (!isMemberResult) {
        logger.warn('Unauthorized workspace access attempt', {
          userId,
          workspaceId,
          path: req.path,
          method: req.method,
        });
        return next(new NotFoundException('Workspace'));
      }
      next();
    } catch (error) {
      logger.error('Error checking workspace membership', { userId, workspaceId, error });
      next(error);
    }
  };
}

/**
 * Middleware to enforce project access control.
 *
 * Extracts projectId from req.params.projectId and verifies that:
 * 1. The project exists
 * 2. The project's workspace is accessible by the user
 *
 * Returns 404 when access is denied — never reveal project/workspace
 * existence to non-members.
 *
 * Usage:
 *   router.get('/:projectId', authMiddleware, requireProjectAccess(), handler)
 */
export function requireProjectAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { projectId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return next(new NotFoundException('User not authenticated'));
    }

    if (!projectId) {
      return next(new NotFoundException('Project'));
    }

    try {
      // Dynamically import to avoid circular dependency
      const { prisma } = await import('@synora/database');

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      });

      if (!project) {
        return next(new NotFoundException('Project'));
      }

      const isMemberResult = await isMember(userId, project.workspaceId);
      if (!isMemberResult) {
        logger.warn('Unauthorized project access attempt', {
          userId,
          projectId,
          workspaceId: project.workspaceId,
          path: req.path,
          method: req.method,
        });
        return next(new NotFoundException('Project'));
      }

      // Attach workspaceId to request for reference
      req.params.workspaceId = project.workspaceId;
      next();
    } catch (error) {
      logger.error('Error checking project access', { userId, projectId, error });
      next(error);
    }
  };
}

/**
 * Middleware to enforce folder access control (within a workspace/project).
 *
 * Extracts folderId from req.params.folderId and verifies that:
 * 1. The folder exists
 * 2. The folder's workspace is accessible by the user
 *
 * Usage:
 *   router.get('/:folderId/contents', authMiddleware, requireFolderAccess(), handler)
 */
export function requireFolderAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { folderId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return next(new NotFoundException('User not authenticated'));
    }

    if (!folderId) {
      return next(new NotFoundException('Folder'));
    }

    try {
      const { prisma } = await import('@synora/database');

      const folder = await prisma.folder.findUnique({
        where: { id: folderId },
        select: { workspaceId: true },
      });

      if (!folder) {
        return next(new NotFoundException('Folder'));
      }

      const isMemberResult = await isMember(userId, folder.workspaceId);
      if (!isMemberResult) {
        logger.warn('Unauthorized folder access attempt', {
          userId,
          folderId,
          workspaceId: folder.workspaceId,
          path: req.path,
          method: req.method,
        });
        return next(new NotFoundException('Folder'));
      }

      req.params.workspaceId = folder.workspaceId;
      next();
    } catch (error) {
      logger.error('Error checking folder access', { userId, folderId, error });
      next(error);
    }
  };
}

/**
 * Middleware to enforce asset access control.
 *
 * Extracts assetId from req.params.assetId and verifies that:
 * 1. The asset exists
 * 2. The asset's workspace is accessible by the user
 *
 * Usage:
 *   router.delete('/:assetId', authMiddleware, requireAssetAccess(), handler)
 */
export function requireAssetAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { assetId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return next(new NotFoundException('User not authenticated'));
    }

    if (!assetId) {
      return next(new NotFoundException('Asset'));
    }

    try {
      const { prisma } = await import('@synora/database');

      const asset = await prisma.asset.findUnique({
        where: { id: assetId },
        select: { workspaceId: true },
      });

      if (!asset) {
        return next(new NotFoundException('Asset'));
      }

      const isMemberResult = await isMember(userId, asset.workspaceId);
      if (!isMemberResult) {
        logger.warn('Unauthorized asset access attempt', {
          userId,
          assetId,
          workspaceId: asset.workspaceId,
          path: req.path,
          method: req.method,
        });
        return next(new NotFoundException('Asset'));
      }

      req.params.workspaceId = asset.workspaceId;
      next();
    } catch (error) {
      logger.error('Error checking asset access', { userId, assetId, error });
      next(error);
    }
  };
}
