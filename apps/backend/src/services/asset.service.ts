import { prisma } from '@synora/database';
import type { Asset } from '@synora/database';
import { NotFoundException, ValidationException } from '@synora/shared';
import { requireMembership } from './workspace.service';
import { requirePermission } from './permissions';
import { recordAuditEvent } from './audit.service';
import { uploadWorkspaceAsset, deleteWorkspaceAsset } from '../storage';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { emitWorkflowEvent } from '../workflows/event-dispatch';

export async function uploadAsset(
  userId: string,
  workspaceId: string,
  input: { buffer: Buffer; contentType: string; filename: string; projectId?: string; folderId?: string }
): Promise<Asset> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'asset:upload');

  if (input.buffer.length > getConfig().storage.maxAssetUploadBytes) {
    throw new ValidationException(
      `File is too large. Maximum size is ${Math.floor(getConfig().storage.maxAssetUploadBytes / 1024 / 1024)}MB.`
    );
  }

  if (input.folderId) {
    const folder = await prisma.folder.findFirst({ where: { id: input.folderId, workspaceId } });
    if (!folder) {
      throw new ValidationException('Folder does not belong to this workspace.');
    }
  }
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, workspaceId } });
    if (!project) {
      throw new ValidationException('Project does not belong to this workspace.');
    }
  }

  const stored = await uploadWorkspaceAsset({
    workspaceId,
    filename: input.filename,
    buffer: input.buffer,
    contentType: input.contentType,
  });

  const asset = await prisma.asset.create({
    data: {
      workspaceId,
      projectId: input.projectId,
      folderId: input.folderId,
      name: input.filename,
      url: stored.url,
      key: stored.key,
      mimeType: input.contentType,
      size: input.buffer.length,
      uploadedById: userId,
    },
  });

  await recordAuditEvent(workspaceId, userId, 'asset.uploaded', 'asset', asset.id, {
    name: asset.name,
    size: asset.size,
  });

  // Announced, not awaited: an automation listening for uploads must not
  // be able to fail somebody's upload. Dispatch happens on the next tick.
  emitWorkflowEvent({
    name: 'asset.uploaded',
    workspaceId,
    actorId: userId,
    subjectId: asset.id,
    subjectName: asset.name,
    projectId: asset.projectId ?? undefined,
    mimeType: asset.mimeType,
  });

  return asset;
}

export async function listAssets(
  userId: string,
  workspaceId: string,
  filter: { projectId?: string; folderId?: string | null } = {}
): Promise<Asset[]> {
  await requireMembership(userId, workspaceId);

  return prisma.asset.findMany({
    where: {
      workspaceId,
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
      ...(filter.folderId !== undefined ? { folderId: filter.folderId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteAsset(userId: string, workspaceId: string, assetId: string): Promise<void> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'asset:delete');

  const asset = await prisma.asset.findFirst({ where: { id: assetId, workspaceId } });
  if (!asset) {
    throw new NotFoundException('Asset');
  }

  await prisma.asset.delete({ where: { id: assetId } });
  await deleteWorkspaceAsset(asset.key).catch((error) =>
    logger.warn('[assets] failed to delete asset from storage', {
      key: asset.key,
      error: error instanceof Error ? error.message : String(error),
    })
  );

  await recordAuditEvent(workspaceId, userId, 'asset.deleted', 'asset', assetId, { name: asset.name });
}
