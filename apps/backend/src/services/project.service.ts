import { prisma } from '@synora/database';
import type { Project, ProjectStatus, WorkspaceRole } from '@synora/database';
import { NotFoundException } from '@synora/shared';
import { requireMembership } from './workspace.service';
import { requirePermission } from './permissions';
import { recordAuditEvent } from './audit.service';
import { deleteWorkspaceAsset } from '../storage';
import { logger } from '../utils/logger';
import { emitWorkflowEvent } from '../workflows/event-dispatch';

/**
 * A project either belongs to a single user (personal, `workspaceId: null`
 * — the Release 1 behavior) or to a workspace (shared, membership- and
 * permission-checked). Every function here accepts both shapes; callers
 * never need to branch on which kind of project they're touching.
 */

async function assertProjectAccess(
  userId: string,
  project: Pick<Project, 'userId' | 'workspaceId'>
): Promise<{ role: WorkspaceRole } | null> {
  if (project.workspaceId) {
    return requireMembership(userId, project.workspaceId);
  }
  if (project.userId !== userId) {
    throw new NotFoundException('Project');
  }
  return null;
}

export async function createProject(
  userId: string,
  input: { name: string; description?: string; goal?: string; workspaceId?: string }
): Promise<Project> {
  if (input.workspaceId) {
    const membership = await requireMembership(userId, input.workspaceId);
    requirePermission(membership.role, 'project:create');
  }

  const project = await prisma.project.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      // What "done" would look like, in their words. Never required —
      // nobody should have to articulate a goal before being allowed to
      // start, and many projects only become clear once underway.
      goal: input.goal,
      workspaceId: input.workspaceId,
    },
  });

  if (input.workspaceId) {
    await recordAuditEvent(input.workspaceId, userId, 'project.created', 'project', project.id, {
      name: project.name,
    });
    // Only workspace projects announce themselves: an event trigger is
    // scoped to a workspace, so a personal project has nothing listening
    // and no workspace to name.
    emitWorkflowEvent({
      name: 'project.created',
      workspaceId: input.workspaceId,
      actorId: userId,
      subjectId: project.id,
      subjectName: project.name,
      projectId: project.id,
    });
  }

  return project;
}

export async function listProjectsForUser(userId: string, workspaceId?: string): Promise<Project[]> {
  if (workspaceId) {
    await requireMembership(userId, workspaceId);
    return prisma.project.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  }
  return prisma.project.findMany({ where: { userId, workspaceId: null }, orderBy: { createdAt: 'desc' } });
}

export async function getProjectForUser(userId: string, projectId: string): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new NotFoundException('Project');
  }
  await assertProjectAccess(userId, project);
  return project;
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: { name?: string; description?: string; goal?: string; status?: ProjectStatus }
): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new NotFoundException('Project');
  }

  const membership = await assertProjectAccess(userId, project);
  if (membership) {
    requirePermission(membership.role, 'project:update');
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  if (project.workspaceId) {
    await recordAuditEvent(project.workspaceId, userId, 'project.updated', 'project', project.id, input);
  }

  return updated;
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new NotFoundException('Project');
  }

  const membership = await assertProjectAccess(userId, project);
  if (membership) {
    requirePermission(membership.role, 'project:delete');
  }

  // Deleting the project cascades the DB rows for its folders/assets (see
  // schema), but the underlying storage objects are only known here — fetch
  // their keys first so we can clean them up (best-effort) after the delete.
  const assets = await prisma.asset.findMany({ where: { projectId }, select: { key: true } });

  await prisma.project.delete({ where: { id: projectId } });

  await Promise.all(
    assets.map((asset) =>
      deleteWorkspaceAsset(asset.key).catch((error) =>
        logger.warn('[projects] failed to delete asset from storage during project delete', {
          key: asset.key,
          error: error instanceof Error ? error.message : String(error),
        })
      )
    )
  );

  if (project.workspaceId) {
    await recordAuditEvent(project.workspaceId, userId, 'project.deleted', 'project', projectId, {
      name: project.name,
    });
  }
}
