import { prisma } from '@synora/database';
import { ConversationFolder } from '@prisma/client';
import { NotFoundException } from '@synora/shared';
import { logger } from '../utils/logger';
import { requireMembership } from './checks';
import { requirePermission } from './permissions';

export interface CreateFolderInput {
  name: string;
  parentId?: string;
}

export interface UpdateFolderInput {
  name: string;
}

export interface FolderWithHierarchy extends ConversationFolder {
  children?: FolderWithHierarchy[];
  conversationCount?: number;
}

export class FolderService {
  async createFolder(
    userId: string,
    workspaceId: string,
    input: CreateFolderInput
  ): Promise<ConversationFolder> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'conversation-folder:manage');

    if (input.parentId) {
      const parentFolder = await prisma.conversationFolder.findUnique({
        where: { id: input.parentId },
      });

      if (!parentFolder || parentFolder.workspaceId !== workspaceId) {
        throw new NotFoundException('Parent folder not found');
      }
    }

    const folder = await prisma.conversationFolder.create({
      data: {
        name: input.name,
        workspaceId,
        parentId: input.parentId,
        createdById: userId,
      },
    });

    logger.info('[FolderService] Folder created', {
      folderId: folder.id,
      workspaceId,
      name: folder.name,
    });

    return folder;
  }

  async getFoldersByWorkspace(userId: string, workspaceId: string): Promise<FolderWithHierarchy[]> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'conversation-folder:manage');

    const folders = await prisma.conversationFolder.findMany({
      where: {
        workspaceId,
        parentId: null,
      },
      include: {
        children: true,
      },
      orderBy: { name: 'asc' },
    });

    return Promise.all(folders.map((f) => this.enrichFolder(f)));
  }

  async getFolderWithChildren(userId: string, folderId: string): Promise<FolderWithHierarchy> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id: folderId },
      include: {
        workspace: true,
        children: true,
      },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    await requireMembership(userId, folder.workspaceId);

    return this.enrichFolder(folder);
  }

  async updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderInput
  ): Promise<ConversationFolder> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id: folderId },
      include: { workspace: true },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const membership = await requireMembership(userId, folder.workspaceId);
    requirePermission(membership.role, 'conversation-folder:manage');

    const updated = await prisma.conversationFolder.update({
      where: { id: folderId },
      data: { name: input.name },
    });

    logger.info('[FolderService] Folder updated', { folderId, name: updated.name });
    return updated;
  }

  async moveFolder(
    userId: string,
    folderId: string,
    newParentId: string | null
  ): Promise<ConversationFolder> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id: folderId },
      include: { workspace: true },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const membership = await requireMembership(userId, folder.workspaceId);
    requirePermission(membership.role, 'conversation-folder:manage');

    if (newParentId) {
      if (newParentId === folderId) {
        throw new Error('Cannot move folder into itself');
      }

      const isDescendant = await this.isDescendantOf(folderId, newParentId);
      if (isDescendant) {
        throw new Error('Cannot move folder into one of its descendants');
      }

      const parentFolder = await prisma.conversationFolder.findUnique({
        where: { id: newParentId },
      });

      if (!parentFolder || parentFolder.workspaceId !== folder.workspaceId) {
        throw new NotFoundException('Parent folder not found');
      }
    }

    const updated = await prisma.conversationFolder.update({
      where: { id: folderId },
      data: { parentId: newParentId },
    });

    logger.info('[FolderService] Folder moved', { folderId, newParentId });
    return updated;
  }

  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id: folderId },
      include: { workspace: true, children: true },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const membership = await requireMembership(userId, folder.workspaceId);
    requirePermission(membership.role, 'conversation-folder:manage');

    if (folder.children.length > 0) {
      throw new Error('Cannot delete folder with children. Move or delete children first.');
    }

    const conversationCount = await prisma.conversation.count({
      where: { folderId },
    });

    if (conversationCount > 0) {
      throw new Error('Cannot delete folder with conversations. Move conversations first.');
    }

    await prisma.conversationFolder.delete({
      where: { id: folderId },
    });

    logger.info('[FolderService] Folder deleted', { folderId });
  }

  async moveConversationToFolder(
    userId: string,
    conversationId: string,
    folderId: string | null
  ): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const membership = await requireMembership(userId, conversation.workspaceId);
    requirePermission(membership.role, 'conversation:manage');

    if (folderId) {
      const folder = await prisma.conversationFolder.findUnique({
        where: { id: folderId },
      });

      if (!folder || folder.workspaceId !== conversation.workspaceId) {
        throw new NotFoundException('Folder not found');
      }
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { folderId },
    });

    logger.info('[FolderService] Conversation moved to folder', { conversationId, folderId });
  }

  private async isDescendantOf(parentId: string, potentialDescendantId: string): Promise<boolean> {
    const descendant = await prisma.conversationFolder.findUnique({
      where: { id: potentialDescendantId },
    });

    if (!descendant || !descendant.parentId) {
      return false;
    }

    if (descendant.parentId === parentId) {
      return true;
    }

    return this.isDescendantOf(parentId, descendant.parentId);
  }

  private async enrichFolder(folder: ConversationFolder & { children?: ConversationFolder[] }): Promise<FolderWithHierarchy> {
    const conversationCount = await prisma.conversation.count({
      where: { folderId: folder.id },
    });

    const enrichedChildren = folder.children
      ? await Promise.all(folder.children.map((child) => this.enrichFolder(child)))
      : undefined;

    return {
      ...folder,
      conversationCount,
      children: enrichedChildren,
    };
  }
}

export const folderService = new FolderService();
