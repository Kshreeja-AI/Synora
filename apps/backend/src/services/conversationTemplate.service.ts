import { prisma } from '@synora/database'
import { ConversationTemplate, Prisma } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'
import { requirePermission } from './permissions'

export interface CreateConversationTemplateInput {
  name: string
  description?: string
  initialMessages: Array<{ role: string; content: string }>
  category?: string
  isPublic?: boolean
}

export interface UpdateConversationTemplateInput {
  name?: string
  description?: string
  initialMessages?: Array<{ role: string; content: string }>
  category?: string
  isPublic?: boolean
}

export interface ListConversationTemplatesOptions {
  skip?: number
  take?: number
  category?: string
  search?: string
}

export class ConversationTemplateService {
  async create(userId: string, workspaceId: string, input: CreateConversationTemplateInput): Promise<ConversationTemplate> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this workspace')
    }
    requirePermission(member.role, 'template:manage')

    return prisma.conversationTemplate.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        initialMessages: input.initialMessages,
        category: input.category,
        isPublic: input.isPublic || false,
      },
    })
  }

  async getById(userId: string, id: string): Promise<ConversationTemplate | null> {
    const template = await prisma.conversationTemplate.findUnique({
      where: { id },
    })

    if (!template) {
      return null
    }

    if (template.isPublic) {
      return template
    }

    if (template.workspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: template.workspaceId } },
      })

      if (!member) {
        throw new ForbiddenException('You do not have access to this conversation template')
      }
    }

    return template
  }

  async listByWorkspace(userId: string, workspaceId: string, options: ListConversationTemplatesOptions): Promise<{
    templates: ConversationTemplate[]
    total: number
  }> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this workspace')
    }

    const where: Prisma.ConversationTemplateWhereInput = {
      OR: [
        { workspaceId },
        { isPublic: true },
      ],
    }

    if (options.category) {
      where.category = options.category
    }

    if (options.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
          ],
        },
      ]
    }

    const [templates, total] = await Promise.all([
      prisma.conversationTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: options.skip || 0,
        take: options.take || 20,
      }),
      prisma.conversationTemplate.count({ where }),
    ])

    return { templates, total }
  }

  async update(userId: string, id: string, input: UpdateConversationTemplateInput): Promise<ConversationTemplate> {
    const template = await prisma.conversationTemplate.findUnique({
      where: { id },
    })

    if (!template) {
      throw new NotFoundException('Conversation template not found')
    }

    if (template.workspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: template.workspaceId } },
      })

      if (!member) {
        throw new ForbiddenException('You do not have access to this workspace')
      }
      requirePermission(member.role, 'template:manage')
    }

    return prisma.conversationTemplate.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.initialMessages !== undefined && { initialMessages: input.initialMessages }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
      },
    })
  }

  async delete(userId: string, id: string): Promise<void> {
    const template = await prisma.conversationTemplate.findUnique({
      where: { id },
    })

    if (!template) {
      throw new NotFoundException('Conversation template not found')
    }

    if (template.workspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: template.workspaceId } },
      })

      if (!member) {
        throw new ForbiddenException('You do not have access to this workspace')
      }
      requirePermission(member.role, 'template:manage')
    }

    await prisma.conversationTemplate.delete({ where: { id } })
  }

  async incrementUsage(id: string): Promise<ConversationTemplate> {
    return prisma.conversationTemplate.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    })
  }
}

export const conversationTemplateService = new ConversationTemplateService()
