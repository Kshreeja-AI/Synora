import { prisma } from '@synora/database'
import { Message, MessageBranch, MessageRole } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'

export interface CreateBranchInput {
  parentId: string
  content?: string
}

export class BranchService {
  async createBranch(
    userId: string,
    conversationId: string,
    input: CreateBranchInput
  ): Promise<Message & { branch: MessageBranch | null }> {
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
      throw new ForbiddenException('You do not have permission to create branches')
    }

    const parentMessage = await prisma.message.findUnique({
      where: { id: input.parentId },
    })

    if (!parentMessage || parentMessage.conversationId !== conversationId) {
      throw new NotFoundException('Parent message not found in this conversation')
    }

    const existingSiblings = await prisma.message.count({
      where: { parentId: input.parentId, conversationId },
    })

    const message = await prisma.message.create({
      data: {
        conversationId,
        content: input.content || '',
        role: MessageRole.ASSISTANT,
        parentId: input.parentId,
      },
      include: { branch: true },
    })

    await prisma.messageBranch.create({
      data: {
        messageId: message.id,
        branchIndex: existingSiblings,
        isMainBranch: false,
      },
    })

    const updated = await prisma.message.findUnique({
      where: { id: message.id },
      include: { branch: true },
    })

    return updated!
  }

  async getBranches(
    userId: string,
    conversationId: string,
    parentId: string
  ): Promise<(Message & { branch: MessageBranch | null })[]> {
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
      where: { conversationId, parentId },
      include: {
        branch: true,
        children: {
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  async setMainBranch(
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<MessageBranch> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { branch: true, conversation: true },
    })

    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Message not found in this conversation')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: message.conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to set main branch')
    }

    if (message.parentId) {
      await prisma.messageBranch.updateMany({
        where: { message: { parentId: message.parentId, conversationId } },
        data: { isMainBranch: false },
      })
    }

    if (!message.branch) {
      return prisma.messageBranch.create({
        data: {
          messageId,
          branchIndex: 0,
          isMainBranch: true,
        },
      })
    }

    return prisma.messageBranch.update({
      where: { id: message.branch.id },
      data: { isMainBranch: true },
    })
  }

  async deleteBranch(userId: string, conversationId: string, messageId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { branch: true, conversation: true },
    })

    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Message not found in this conversation')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: message.conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to delete branches')
    }

    if (message.branch?.isMainBranch) {
      throw new ForbiddenException('Cannot delete the main branch')
    }

    await prisma.message.delete({
      where: { id: messageId },
    })
  }

  async getMessageTree(
    userId: string,
    conversationId: string
  ): Promise<(Message & { branch: MessageBranch | null; children: Message[] })[]> {
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
        children: {
          take: 1000,
          orderBy: { createdAt: 'asc' },
        },
      },
      take: 1000,
      orderBy: { createdAt: 'asc' },
    })
  }
}

export const branchService = new BranchService()
