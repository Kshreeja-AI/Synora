import { randomBytes } from 'node:crypto'
import { prisma } from '@synora/database'
import { SharedConversation, SharePermission, ConversationCollaborator, CollaboratorRole, Prisma } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'

export interface CreateShareLinkInput {
  permissions?: SharePermission
  isPublic?: boolean
  expiresAt?: Date
}

export interface AddCollaboratorInput {
  userId: string
  role?: CollaboratorRole
}

async function requireConversationAccess(userId: string, conversationId: string, requireWrite = false) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })

  if (!conversation) {
    throw new NotFoundException('Conversation not found')
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
  })

  if (!member) {
    throw new ForbiddenException('You do not have access to this conversation')
  }

  if (requireWrite && member.role === 'VIEWER') {
    throw new ForbiddenException('You do not have permission to manage sharing for this conversation')
  }

  return conversation
}

export class SharingService {
  async createShareLink(
    userId: string,
    conversationId: string,
    input: CreateShareLinkInput
  ): Promise<SharedConversation> {
    await requireConversationAccess(userId, conversationId, true)

    const shareToken = randomBytes(32).toString('hex')

    return prisma.sharedConversation.create({
      data: {
        conversationId,
        shareToken,
        permissions: input.permissions ?? SharePermission.VIEW,
        isPublic: input.isPublic ?? false,
        expiresAt: input.expiresAt,
      },
    })
  }

  async listShareLinks(userId: string, conversationId: string): Promise<SharedConversation[]> {
    await requireConversationAccess(userId, conversationId)

    return prisma.sharedConversation.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async revokeShareLink(userId: string, conversationId: string, shareId: string): Promise<void> {
    await requireConversationAccess(userId, conversationId, true)

    const share = await prisma.sharedConversation.findUnique({ where: { id: shareId } })
    if (!share || share.conversationId !== conversationId) {
      throw new NotFoundException('Share link not found')
    }

    await prisma.sharedConversation.delete({ where: { id: shareId } })
  }

  async getByShareToken(shareToken: string): Promise<{
    conversation: unknown
    permissions: SharePermission
  }> {
    const share = await prisma.sharedConversation.findUnique({
      where: { shareToken },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    })

    if (!share) {
      throw new NotFoundException('Shared conversation not found')
    }

    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new NotFoundException('This share link has expired')
    }

    return { conversation: share.conversation, permissions: share.permissions }
  }

  async addCollaborator(
    userId: string,
    conversationId: string,
    input: AddCollaboratorInput
  ): Promise<ConversationCollaborator> {
    const conversation = await requireConversationAccess(userId, conversationId, true)

    const targetMember = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: input.userId, workspaceId: conversation.workspaceId } },
    })

    if (!targetMember) {
      throw new NotFoundException('User is not a member of this workspace')
    }

    return prisma.conversationCollaborator.upsert({
      where: { conversationId_userId: { conversationId, userId: input.userId } },
      create: {
        conversationId,
        userId: input.userId,
        role: input.role ?? CollaboratorRole.VIEWER,
      },
      update: {
        role: input.role ?? CollaboratorRole.VIEWER,
      },
    })
  }

  async listCollaborators(userId: string, conversationId: string): Promise<ConversationCollaborator[]> {
    await requireConversationAccess(userId, conversationId)

    return prisma.conversationCollaborator.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async removeCollaborator(userId: string, conversationId: string, collaboratorUserId: string): Promise<void> {
    await requireConversationAccess(userId, conversationId, true)

    const collaborator = await prisma.conversationCollaborator.findUnique({
      where: { conversationId_userId: { conversationId, userId: collaboratorUserId } },
    })

    if (!collaborator) {
      throw new NotFoundException('Collaborator not found')
    }

    await prisma.conversationCollaborator.delete({
      where: { conversationId_userId: { conversationId, userId: collaboratorUserId } },
    })
  }

  async logActivity(conversationId: string, action: string, metadata?: Record<string, unknown>): Promise<void> {
    await prisma.conversationActivity.create({
      data: {
        conversationId,
        action,
        metadata: (metadata as Prisma.InputJsonValue) ?? undefined,
      },
    })
  }

  async listActivity(userId: string, conversationId: string, take = 50) {
    await requireConversationAccess(userId, conversationId)

    return prisma.conversationActivity.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
    })
  }
}

export const sharingService = new SharingService()
