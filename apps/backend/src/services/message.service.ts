import { prisma } from '@synora/database'
import { Message, MessageRole } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'

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

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to add messages')
    }

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

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: message.conversation.workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this message')
    }

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

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this conversation')
    }

    return prisma.message.findMany({
      where: { conversationId },
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

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: message.conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to update this message')
    }

    return prisma.message.update({
      where: { id },
      data: {
        ...(input.content && { content: input.content }),
      },
    })
  }

  async delete(userId: string, id: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: message.conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to delete this message')
    }

    return prisma.message.delete({
      where: { id },
    })
  }

  async addAttachment(
    userId: string,
    messageId: string,
    input: { url: string; mimeType: string; name: string; size: number }
  ): Promise<any> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: message.conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to add attachments')
    }

    return prisma.messageAttachment.create({
      data: {
        messageId,
        ...input,
      },
    })
  }
}

export const messageService = new MessageService()
