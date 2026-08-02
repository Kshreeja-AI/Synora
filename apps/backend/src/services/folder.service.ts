import { prisma } from '@synora/database';
import type { Folder } from '@synora/database';
import { NotFoundException, ValidationException } from '@synora/shared';
import { requireMembership } from './workspace.service';
import { requirePermission } from './permissions';
import { recordAuditEvent } from './audit.service';

async function requireFolderInWorkspace(folderId: string, workspaceId: string): Promise<Folder> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, workspaceId } });
  if (!folder) {
    throw new NotFoundException('Folder');
  }
  return folder;
}

export async function createFolder(
  userId: string,
  workspaceId: string,
  input: { name: string; projectId?: string; parentId?: string }
): Promise<Folder> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'folder:manage');

  if (input.parentId) {
    await requireFolderInWorkspace(input.parentId, workspaceId);
  }
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, workspaceId } });
    if (!project) {
      throw new ValidationException('Project does not belong to this workspace.');
    }
  }

  const folder = await prisma.folder.create({
    data: {
      workspaceId,
      name: input.name,
      projectId: input.projectId,
      parentId: input.parentId,
      createdById: userId,
    },
  });

  await recordAuditEvent(workspaceId, userId, 'folder.created', 'folder', folder.id, { name: folder.name });

  return folder;
}

export async function listFolders(
  userId: string,
  workspaceId: string,
  filter: { projectId?: string; parentId?: string | null } = {}
): Promise<Folder[]> {
  await requireMembership(userId, workspaceId);

  return prisma.folder.findMany({
    where: {
      workspaceId,
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
      ...(filter.parentId !== undefined ? { parentId: filter.parentId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function renameFolder(
  userId: string,
  workspaceId: string,
  folderId: string,
  name: string
): Promise<Folder> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'folder:manage');
  await requireFolderInWorkspace(folderId, workspaceId);

  const folder = await prisma.folder.update({ where: { id: folderId }, data: { name } });
  await recordAuditEvent(workspaceId, userId, 'folder.renamed', 'folder', folderId, { name });

  return folder;
}

export async function deleteFolder(userId: string, workspaceId: string, folderId: string): Promise<void> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'folder:manage');
  const folder = await requireFolderInWorkspace(folderId, workspaceId);

  await prisma.folder.delete({ where: { id: folderId } });
  await recordAuditEvent(workspaceId, userId, 'folder.deleted', 'folder', folderId, { name: folder.name });
}
