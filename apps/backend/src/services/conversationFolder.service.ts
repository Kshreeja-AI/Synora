import { prisma } from '@synora/database'
import { ConversationFolder } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'
import { requirePermission } from './permissions'
import { requireMembership } from './checks'

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
    const member = await requireMembership(userId, workspaceId)
    requirePermission(member.role, 'conversation-folder:manage')

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
    await requireMembership(userId, workspaceId)

    return prisma.conversationFolder.findMany({
      where: {
        workspaceId,
        parentId: parentId || null,
      },
      include: {
        children: { take: 100, orderBy: { name: 'asc' } },
        conversations: { take: 100, orderBy: { title: 'asc' }, select: { id: true, title: true } },
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

    await requireMembership(userId, folder.workspaceId)

    return folder
  }

  async update(userId: string, id: string, input: UpdateConversationFolderInput): Promise<ConversationFolder> {
    const folder = await prisma.conversationFolder.findUnique({
      where: { id },
    })

    if (!folder) {
      throw new NotFoundException('Folder not found')
    }

    const member = await requireMembership(userId, folder.workspaceId)
    requirePermission(member.role, 'conversation-folder:manage')

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

    const member = await requireMembership(userId, folder.workspaceId)
    requirePermission(member.role, 'conversation-folder:manage')

    await prisma.conversationFolder.delete({ where: { id } })
  }

  async moveConversation(userId: string, conversationId: string, folderId: string | null): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const member = await requireMembership(userId, conversation.workspaceId)
    requirePermission(member.role, 'conversation-folder:manage')

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
