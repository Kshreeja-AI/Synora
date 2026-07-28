import { prisma } from '@synora/database'
import { Conversation, ConversationStatus } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'

export interface CreateConversationInput {
  title: string
  description?: string
  provider: string
  model: string
}

export interface UpdateConversationInput {
  title?: string
  description?: string
  provider?: string
  model?: string
  isArchived?: boolean
  isPinned?: boolean
}

export interface ListConversationsOptions {
  archived?: boolean
  pinned?: boolean
  skip?: number
  take?: number
  search?: string
}

export class ConversationService {
  async create(userId: string, workspaceId: string, input: CreateConversationInput): Promise<Conversation> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to create conversations')
    }

    return prisma.conversation.create({
      data: {
        workspaceId,
        title: input.title,
        description: input.description,
        provider: input.provider,
        model: input.model,
        status: ConversationStatus.ACTIVE,
      },
    })
  }

  async getById(userId: string, id: string): Promise<Conversation | null> {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        tags: true,
        collaborators: true,
        usage: true,
      },
    })

    if (!conversation) {
      return null
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this conversation')
    }

    return conversation
  }

  async listByWorkspace(userId: string, workspaceId: string, options: ListConversationsOptions): Promise<{
    conversations: Conversation[]
    total: number
  }> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this workspace')
    }

    const where: any = {
      workspaceId,
      status: options.archived ? ConversationStatus.ARCHIVED : ConversationStatus.ACTIVE,
    }

    if (options.pinned !== undefined) {
      where.isPinned = options.pinned
    }

    if (options.search) {
      where.OR = [
        { title: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
      ]
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip || 0,
        take: options.take || 20,
        include: {
          tags: true,
          usage: true,
        },
      }),
      prisma.conversation.count({ where }),
    ])

    return { conversations, total }
  }

  async update(userId: string, id: string, input: UpdateConversationInput): Promise<Conversation> {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to update this conversation')
    }

    return prisma.conversation.update({
      where: { id },
      data: {
        ...(input.title && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.provider && { provider: input.provider }),
        ...(input.model && { model: input.model }),
        ...(input.isArchived !== undefined && {
          isArchived: input.isArchived,
          status: input.isArchived ? ConversationStatus.ARCHIVED : ConversationStatus.ACTIVE,
        }),
        ...(input.isPinned !== undefined && { isPinned: input.isPinned }),
      },
    })
  }

  async archive(userId: string, id: string): Promise<Conversation> {
    return this.update(userId, id, { isArchived: true })
  }

  async restore(userId: string, id: string): Promise<Conversation> {
    return this.update(userId, id, { isArchived: false })
  }

  async delete(userId: string, id: string): Promise<Conversation> {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })

    if (!member || member.role === 'VIEWER') {
      throw new ForbiddenException('You do not have permission to delete this conversation')
    }

    return prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.DELETED },
    })
  }
}

export const conversationService = new ConversationService()
