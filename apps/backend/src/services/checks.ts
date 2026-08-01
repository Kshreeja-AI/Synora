import { prisma } from '@synora/database';
import type { WorkspaceRole } from '@synora/database';
import { NotFoundException } from '@synora/shared';

/**
 * Workspace membership verification and permission checks that don't depend
 * on other services. This module exists to break the circular dependency
 * between workspace.service and audit.service.
 */

export async function requireMembership(
  userId: string,
  workspaceId: string
): Promise<{ id: string; role: WorkspaceRole }> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });

  if (!membership) {
    throw new NotFoundException('Workspace');
  }

  return membership;
}

export async function isMember(userId: string, workspaceId: string): Promise<boolean> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  return !!membership;
}
