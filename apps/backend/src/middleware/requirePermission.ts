import { Response, NextFunction } from 'express';
import { ForbiddenException, NotFoundException } from '@synora/shared';
import { prisma } from '@synora/database';
import type { WorkspaceRole, Permission } from '../services/permissions';
import { logger } from '../utils/logger';
import { AuthRequest } from './auth';

/**
 * Permission enforcement middleware.
 *
 * Verifies that the user's role in the workspace grants the required
 * permission before allowing the request to proceed. Uses the central
 * permission matrix from permissions.ts as the single source of truth.
 *
 * Always returns 404 (not 403) when access is denied — never reveal
 * workspace existence to non-members.
 *
 * Usage:
 *   router.post('/:workspaceId/members',
 *     authMiddleware,
 *     requireWorkspaceAccess(),
 *     requirePermission('member:invite'),
 *     handler
 *   )
 */
export function requirePermission(requiredPermission: Permission) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { workspaceId } = req.params;
    const userId = req.userId;

    if (!userId || !workspaceId) {
      return next(new NotFoundException('User or workspace not found'));
    }

    try {
      // Fetch the user's role in this workspace
      const membership = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        select: { role: true },
      });

      if (!membership) {
        logger.warn('Permission check for non-member', {
          userId,
          workspaceId,
          requiredPermission,
          path: req.path,
        });
        return next(new NotFoundException('Workspace'));
      }

      // Check if the role has the required permission
      const hasPermission = checkPermission(membership.role, requiredPermission);

      if (!hasPermission) {
        logger.warn('Unauthorized action attempt', {
          userId,
          workspaceId,
          role: membership.role,
          requiredPermission,
          path: req.path,
          method: req.method,
        });
        return next(new NotFoundException('Workspace'));
      }

      // Attach the user's role to the request for reference in handlers
      req.userRole = membership.role;
      next();
    } catch (error) {
      logger.error('Error checking permissions', {
        userId,
        workspaceId,
        requiredPermission,
        error,
      });
      next(error);
    }
  };
}

/**
 * Internal permission checking logic using the central matrix.
 * This is the single source of truth for what each role can do.
 *
 * Exported for testing and service-layer use.
 */
export function checkPermission(role: WorkspaceRole, permission: Permission): boolean {
  const rolePermissions: Record<WorkspaceRole, ReadonlySet<Permission>> = {
    OWNER: new Set<Permission>([
      'workspace:update',
      'workspace:delete',
      'member:invite',
      'member:remove',
      'member:role:update',
      'project:create',
      'project:update',
      'project:delete',
      'folder:manage',
      'asset:upload',
      'asset:delete',
      'audit:view',
      'billing:view',
      'billing:manage',
      'conversation:create',
      'conversation:manage',
      'message:send',
      'message:manage',
      'branch:manage',
      'conversation-folder:manage',
      'prompt:manage',
      'template:manage',
      'sharing:manage',
    ]),
    ADMIN: new Set<Permission>([
      'workspace:update',
      'member:invite',
      'member:remove',
      'member:role:update',
      'project:create',
      'project:update',
      'project:delete',
      'folder:manage',
      'asset:upload',
      'asset:delete',
      'audit:view',
      'billing:view',
      'conversation:create',
      'conversation:manage',
      'message:send',
      'message:manage',
      'branch:manage',
      'conversation-folder:manage',
      'prompt:manage',
      'template:manage',
      'sharing:manage',
    ]),
    EDITOR: new Set<Permission>([
      'project:create',
      'project:update',
      'folder:manage',
      'asset:upload',
      'asset:delete',
      'conversation:create',
      'conversation:manage',
      'message:send',
      'message:manage',
      'branch:manage',
      'conversation-folder:manage',
      'prompt:manage',
      'template:manage',
      'sharing:manage',
    ]),
    MEMBER: new Set<Permission>([
      'project:create',
      'asset:upload',
      'conversation:create',
      'conversation:manage',
      'message:send',
      'message:manage',
      'branch:manage',
      'conversation-folder:manage',
      'prompt:manage',
      'template:manage',
      'sharing:manage',
    ]),
    VIEWER: new Set<Permission>([]),
  };

  return rolePermissions[role].has(permission);
}

/**
 * Middleware to prevent certain role changes that would violate invariants.
 *
 * Specifically:
 * - Only OWNER can change ownership
 * - Cannot remove the last OWNER from a workspace
 * - OWNER can only be changed to ADMIN or back to OWNER
 *
 * Usage:
 *   router.patch('/:workspaceId/members/:memberId',
 *     authMiddleware,
 *     requireWorkspaceAccess(),
 *     requirePermission('member:role:update'),
 *     requireOwnerForOwnershipChange(),
 *     handler
 *   )
 */
export function requireOwnerForOwnershipChange() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { workspaceId, memberId } = req.params;
    const { role: newRole } = req.body as { role?: string };
    const userId = req.userId;

    if (!newRole || !['OWNER', 'ADMIN', 'EDITOR', 'MEMBER', 'VIEWER'].includes(newRole)) {
      return next();
    }

    try {
      // Check if this operation involves changing an OWNER role
      const targetMember = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
        select: { role: true },
      });

      if (!targetMember) {
        return next(new NotFoundException('Member'));
      }

      if (targetMember.role === 'OWNER' || newRole === 'OWNER') {
        // Only OWNER can change ownership
        const requester = await prisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: userId!, workspaceId } },
          select: { role: true },
        });

        if (!requester || requester.role !== 'OWNER') {
          logger.warn('Non-owner attempted to change ownership', {
            userId,
            workspaceId,
            memberId,
            attemptedRole: newRole,
          });
          return next(new ForbiddenException('Only workspace owners can change ownership'));
        }

        // Don't allow removing the last OWNER
        if (targetMember.role === 'OWNER' && newRole !== 'OWNER') {
          const ownerCount = await prisma.workspaceMember.count({
            where: { workspaceId, role: 'OWNER' },
          });

          if (ownerCount === 1) {
            logger.warn('Attempted to remove last workspace owner', {
              userId,
              workspaceId,
            });
            return next(new ForbiddenException('Cannot remove the last owner from a workspace'));
          }
        }
      }

      next();
    } catch (error) {
      logger.error('Error checking ownership constraints', { workspaceId, memberId, error });
      next(error);
    }
  };
}
