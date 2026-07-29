import { prisma } from '@synora/database'
import { Message, MessageRole, MessageAttachment } from '@prisma/client'
import { NotFoundException } from '@synora/shared'
import { requirePermission } from './permissions'
import { requireMembership } from './checks'

export interface CreateMessageInput {
  content: string
  role: MessageRole
  parentId?: string
}

export interface UpdateMessageInput {
  content?: string
}

export class MessageService {
  async create(userId: string, conversationId: string, input: CreateMessageInput): Promise<Message> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const membership = await requireMembership(userId, conversation.workspaceId)
    requirePermission(membership.role, 'message:send')

    const message = await prisma.message.create({
      data: {
        conversationId,
        content: input.content,
        role: input.role,
        parentId: input.parentId,
      },
      include: {
        branch: true,
        children: true,
        attachments: true,
      },
    })

    if (!input.parentId && input.role === MessageRole.ASSISTANT) {
      await prisma.messageBranch.create({
        data: {
          messageId: message.id,
          branchIndex: 0,
          isMainBranch: true,
        },
      })
    }

    return message
  }

  async getById(userId: string, id: string): Promise<Message | null> {
    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        children: {
          orderBy: { createdAt: 'asc' },
        },
        branch: true,
        attachments: true,
        conversation: true,
      },
    })

    if (!message) {
      return null
    }

    await requireMembership(userId, message.conversation.workspaceId)

    return message
  }

  async getConversationHistory(
    userId: string,
    conversationId: string,
    options?: { skip?: number; take?: number }
  ): Promise<Message[]> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    await requireMembership(userId, conversation.workspaceId)

    return prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: {
        branch: true,
        attachments: true,
      },
      orderBy: { createdAt: 'asc' },
      skip: options?.skip || 0,
      take: options?.take || 100,
    })
  }

  async update(userId: string, id: string, input: UpdateMessageInput): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const membership = await requireMembership(userId, message.conversation.workspaceId)
    requirePermission(membership.role, 'message:manage')

    return prisma.message.update({
      where: { id },
      data: {
        ...(input.content && { content: input.content }),
      },
    })
  }

  /** Soft delete (sets `deletedAt`) — never a real SQL DELETE, so this
   * never triggers the parentId self-relation's cascade (see M1's schema
   * comment on Message.deletedAt). Idempotent: deleting an
   * already-deleted message is a no-op, not an error, matching the
   * delete-is-idempotent convention used elsewhere (StorageProvider.delete,
   * Conversation.delete). */
  async delete(userId: string, id: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const membership = await requireMembership(userId, message.conversation.workspaceId)
    requirePermission(membership.role, 'message:manage')

    if (message.deletedAt) {
      return message
    }

    return prisma.message.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  }

  async addAttachment(
    userId: string,
    messageId: string,
    input: { url: string; mimeType: string; name: string; size: number }
  ): Promise<MessageAttachment> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const membership = await requireMembership(userId, message.conversation.workspaceId)
    requirePermission(membership.role, 'message:send')

    return prisma.messageAttachment.create({
      data: {
        messageId,
        ...input,
      },
    })
  }
}

export const messageService = new MessageService()
