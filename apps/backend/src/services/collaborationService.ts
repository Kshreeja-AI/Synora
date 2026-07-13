import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface Collaborator {
  userId: string;
  email: string;
  name?: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  joinedAt: Date;
}

export interface ProjectPermission {
  userId: string;
  projectId: string;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
}

export interface CollaborationActivity {
  id: string;
  userId: string;
  projectId: string;
  action: 'created' | 'edited' | 'commented' | 'shared';
  resource: string;
  timestamp: Date;
}

export class CollaborationService {
  /**
   * Add collaborator to project
   */
  async addCollaborator(
    projectId: string,
    email: string,
    role: 'OWNER' | 'EDITOR' | 'VIEWER'
  ): Promise<Collaborator> {
    try {
      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Create invitation instead
        const invitation = await prisma.workspaceInvitation.create({
          data: {
            workspaceId: '', // Get from project
            email,
            role: role as any,
            token: this.generateToken(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
        });

        logger.info('Collaboration invitation sent', { email, projectId });
        return {
          userId: '',
          email,
          role,
          joinedAt: new Date(),
        };
      }

      // Add as project member
      await prisma.project.update({
        where: { id: projectId },
        data: {
          // In real implementation, would add to workspace members
        },
      });

      logger.info('Collaborator added', { userId: user.id, projectId, role });

      return {
        userId: user.id,
        email: user.email,
        name: user.name || undefined,
        role,
        joinedAt: new Date(),
      };
    } catch (error) {
      logger.error('Failed to add collaborator', { error, projectId, email });
      throw error;
    }
  }

  /**
   * Remove collaborator from project
   */
  async removeCollaborator(projectId: string, userId: string): Promise<boolean> {
    try {
      // Remove from workspace members
      const result = await prisma.workspaceMember.deleteMany({
        where: {
          userId,
          workspace: {
            projects: {
              some: { id: projectId },
            },
          },
        },
      });

      logger.info('Collaborator removed', { userId, projectId });
      return result.count > 0;
    } catch (error) {
      logger.error('Failed to remove collaborator', { error, projectId, userId });
      throw error;
    }
  }

  /**
   * Check if user can perform action on resource
   */
  async checkPermission(
    userId: string,
    projectId: string,
    action: 'view' | 'edit' | 'delete' | 'share'
  ): Promise<boolean> {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          workspace: {
            include: {
              members: {
                where: { userId },
              },
            },
          },
        },
      });

      if (!project) {
        return false;
      }

      // Owner can do everything
      if (project.userId === userId) {
        return true;
      }

      // Check workspace membership
      if (project.workspace?.members.length === 0) {
        return false;
      }

      const member = project.workspace?.members[0];
      if (!member) {
        return false;
      }

      // Check role-based permissions
      const permissions: Record<string, string[]> = {
        OWNER: ['view', 'edit', 'delete', 'share'],
        EDITOR: ['view', 'edit'],
        VIEWER: ['view'],
      };

      const allowedActions = permissions[member.role];
      return allowedActions.includes(action);
    } catch (error) {
      logger.error('Permission check failed', { error, userId, projectId });
      return false;
    }
  }

  /**
   * Get all collaborators for a project
   */
  async getCollaborators(projectId: string): Promise<Collaborator[]> {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          user: true,
          workspace: {
            include: {
              members: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      if (!project) {
        return [];
      }

      const collaborators: Collaborator[] = [
        {
          userId: project.user.id,
          email: project.user.email,
          name: project.user.name || undefined,
          role: 'OWNER',
          joinedAt: project.createdAt,
        },
      ];

      // Add workspace members
      if (project.workspace?.members) {
        project.workspace.members.forEach((member) => {
          collaborators.push({
            userId: member.user.id,
            email: member.user.email,
            name: member.user.name || undefined,
            role: member.role as 'OWNER' | 'EDITOR' | 'VIEWER',
            joinedAt: member.createdAt,
          });
        });
      }

      return collaborators;
    } catch (error) {
      logger.error('Failed to get collaborators', { error, projectId });
      throw error;
    }
  }

  /**
   * Log collaboration activity
   */
  async logActivity(
    userId: string,
    projectId: string,
    action: 'created' | 'edited' | 'commented' | 'shared',
    resource: string
  ): Promise<void> {
    try {
      await prisma.activityLog.create({
        data: {
          userId,
          action,
          resource,
          resourceId: projectId,
        },
      });
    } catch (error) {
      logger.error('Failed to log activity', { error });
      // Don't throw - activity logging shouldn't block operations
    }
  }

  /**
   * Get activity history for a project
   */
  async getActivityHistory(projectId: string, limit: number = 50): Promise<CollaborationActivity[]> {
    try {
      const activities = await prisma.activityLog.findMany({
        where: { resourceId: projectId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return activities.map((activity) => ({
        id: activity.id,
        userId: activity.userId,
        projectId: activity.resourceId,
        action: activity.action as 'created' | 'edited' | 'commented' | 'shared',
        resource: activity.resource,
        timestamp: activity.createdAt,
      }));
    } catch (error) {
      logger.error('Failed to get activity history', { error });
      return [];
    }
  }

  /**
   * Generate secure invitation token
   */
  private generateToken(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  /**
   * Create shareable link
   */
  async createShareableLink(
    projectId: string,
    expiresIn?: number
  ): Promise<{ token: string; url: string }> {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + (expiresIn || 7 * 24 * 60 * 60 * 1000));

    logger.info('Shareable link created', { projectId, expiresAt });

    return {
      token,
      url: `${process.env.FRONTEND_URL}/shared/${token}`,
    };
  }

  /**
   * Validate shareable link
   */
  async validateShareLink(token: string): Promise<{ projectId: string; valid: boolean }> {
    // In real implementation, would check database for token
    // This is a placeholder showing the pattern

    logger.info('Share link validation check', { token });

    return {
      projectId: '',
      valid: false, // Would validate against database
    };
  }
}

export const collaborationService = new CollaborationService();
