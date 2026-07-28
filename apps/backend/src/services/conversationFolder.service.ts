import { prisma } from '@synora/database'
import { ConversationFolder } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'

export interface CreateConversationFolderInput {
  name: string
  parentId?: string
}

export interface UpdateConversationFolderInput {
  name?: string
  parentId?: string | null
}

export class ConversationFolderService {
  async create(userId: string, workspaceId: string, input: CreateConversationFolderInput): Promise<ConversationFolder> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to create folders')
    }

    if (input.parentId) {
      const parent = await prisma.conversationFolder.findUnique({
        where: { id: input.parentId },
      })
      if (!parent || parent.workspaceId !== workspaceId) {
        throw new NotFoundException('Parent folder not found')
      }
    }

    return prisma.conversationFolder.create({
      data: {
        workspaceId,
        name: input.name,
        parentId: input.parentId,
        createdById: userId,
      },
      include: {
        children: true,
        conversations: { select: { id: true, title: true } },
      },
    })
  }

  async listByWorkspace(userId: string, workspaceId: string, parentId?: string): Promise<ConversationFolder[]> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this workspace')
    }

    return prisma.conversationFolder.findMany({
      where: {
        workspaceId,
        parentId: parentId || null,
      },
      include: {
        children: true,
        conversations: { select: { id: true, title: true } },
        _count: { select: { conversations: true, children: true } },
      },
      orderBy: { name: 'asc' },
    })
  }

  async getById(userId: string, id: string): Promise<ConversationFolder | null> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id },
      include: {
        children: { orderBy: { name: 'asc' } },
        conversations: {
          orderBy: { updatedAt: 'desc' },
          select: { id: true, title: true, updatedAt: true, status: true },
        },
      },
    })

    if (!folder) {
      return null
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: folder.workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this folder')
    }

    return folder
  }

  async update(userId: string, id: string, input: UpdateConversationFolderInput): Promise<ConversationFolder> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id },
    })

    if (!folder) {
      throw new NotFoundException('Folder not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: folder.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to update this folder')
    }

    if (input.parentId) {
      if (input.parentId === id) {
        throw new ForbiddenException('Cannot set folder as its own parent')
      }
      const parent = await prisma.conversationFolder.findUnique({
        where: { id: input.parentId },
      })
      if (!parent || parent.workspaceId !== folder.workspaceId) {
        throw new NotFoundException('Parent folder not found')
      }
    }

    return prisma.conversationFolder.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
      },
      include: {
        children: true,
        conversations: { select: { id: true, title: true } },
      },
    })
  }

  async delete(userId: string, id: string): Promise<void> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id },
    })

    if (!folder) {
      throw new NotFoundException('Folder not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: folder.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to delete this folder')
    }

    await prisma.conversationFolder.delete({ where: { id } })
  }

  async moveConversation(userId: string, conversationId: string, folderId: string | null): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to move conversations')
    }

    if (folderId) {
      const folder = await prisma.conversationFolder.findUnique({
        where: { id: folderId },
      })
      if (!folder || folder.workspaceId !== conversation.workspaceId) {
        throw new NotFoundException('Folder not found')
      }
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { folderId },
    })
  }
}

export const conversationFolderService = new ConversationFolderService()
