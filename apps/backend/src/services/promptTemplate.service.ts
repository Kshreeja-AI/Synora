import { prisma } from '@synora/database'
import { PromptTemplate, Prisma } from '@prisma/client'
import { ForbiddenException, NotFoundException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requirePermission } from './permissions'

export interface CreatePromptTemplateInput {
  name: string
  description?: string
  content: string
  category?: string
  tags?: string[]
  isPublic?: boolean
}

export interface UpdatePromptTemplateInput {
  name?: string
  description?: string
  content?: string
  category?: string
  tags?: string[]
  isPublic?: boolean
  isFavorite?: boolean
}

export interface ListPromptTemplatesOptions {
  skip?: number
  take?: number
  category?: string
  isPublic?: boolean
  search?: string
}

export class PromptTemplateService {
  async create(userId: string, workspaceId: string, input: CreatePromptTemplateInput): Promise<PromptTemplate> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this workspace')
    }
    requirePermission(member.role, 'prompt:manage')

    const prompt = await prisma.promptTemplate.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        content: input.content,
        category: input.category,
        tags: input.tags || [],
        isPublic: input.isPublic || false,
        createdBy: userId,
        version: 1,
      },
    })

    logger.info('[PromptTemplateService] Prompt created', {
      promptId: prompt.id,
      workspaceId,
      userId,
      isPublic: prompt.isPublic,
    })

    return prompt
  }

  async getById(userId: string, id: string): Promise<PromptTemplate | null> {
    const template = await prisma.promptTemplate.findUnique({
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
        throw new ForbiddenException('You do not have access to this prompt template')
      }
    }

    return template
  }

  async listByWorkspace(userId: string, workspaceId: string, options: ListPromptTemplatesOptions): Promise<{
    templates: PromptTemplate[]
    total: number
  }> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    })

    if (!member) {
      throw new ForbiddenException('You do not have access to this workspace')
    }

    const where: Prisma.PromptTemplateWhereInput = {
      OR: [
        { workspaceId },
        { isPublic: true },
      ],
    }

    if (options.category) {
      where.category = options.category
    }

    if (options.isPublic !== undefined) {
      where.isPublic = options.isPublic
    }

    if (options.search) {
      where.AND = [
        {
          OR: [
            { name: { contains: options.search, mode: 'insensitive' } },
            { content: { contains: options.search, mode: 'insensitive' } },
          ],
        },
      ]
    }

    const [templates, total] = await Promise.all([
      prisma.promptTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: options.skip || 0,
        take: options.take || 20,
      }),
      prisma.promptTemplate.count({ where }),
    ])

    return { templates, total }
  }

  async update(userId: string, id: string, input: UpdatePromptTemplateInput): Promise<PromptTemplate> {
    const template = await prisma.promptTemplate.findUnique({
      where: { id },
    })

    if (!template) {
      throw new NotFoundException('Prompt template not found')
    }

    if (template.workspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: template.workspaceId } },
      })

      if (!member) {
        throw new ForbiddenException('You do not have access to this workspace')
      }
      requirePermission(member.role, 'prompt:manage')
    }

    return prisma.promptTemplate.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
        ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
      },
    })
  }

  async delete(userId: string, id: string): Promise<void> {
    const template = await prisma.promptTemplate.findUnique({
      where: { id },
    })

    if (!template) {
      throw new NotFoundException('Prompt template not found')
    }

    if (template.workspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: template.workspaceId } },
      })

      if (!member) {
        throw new ForbiddenException('You do not have access to this workspace')
      }
      requirePermission(member.role, 'prompt:manage')
    }

    await prisma.promptTemplate.delete({ where: { id } })
  }

  async incrementUsage(id: string): Promise<PromptTemplate> {
    return prisma.promptTemplate.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    })
  }

  async createVersion(
    userId: string,
    promptId: string,
    input: UpdatePromptTemplateInput
  ): Promise<PromptTemplate> {
    const prompt = await prisma.promptTemplate.findUnique({
      where: { id: promptId },
    })

    if (!prompt) {
      throw new NotFoundException('Prompt not found')
    }

    if (prompt.createdBy !== userId) {
      throw new ForbiddenException('You do not have permission to version this prompt')
    }

    const newVersion = await prisma.promptTemplate.create({
      data: {
        name: input.name ?? prompt.name,
        description: input.description ?? prompt.description,
        content: input.content ?? prompt.content,
        category: input.category ?? prompt.category,
        tags: input.tags ?? prompt.tags,
        isPublic: input.isPublic ?? prompt.isPublic,
        workspaceId: prompt.workspaceId,
        createdBy: userId,
        parentId: promptId,
        version: prompt.version + 1,
      },
    })

    logger.info('[PromptTemplateService] Prompt version created', {
      promptId,
      versionId: newVersion.id,
      version: newVersion.version,
      userId,
    })

    return newVersion
  }

  async ratePrompt(userId: string, promptId: string, rating: number): Promise<PromptTemplate> {
    if (rating < 0 || rating > 5) {
      throw new Error('Rating must be between 0 and 5')
    }

    const prompt = await prisma.promptTemplate.findUnique({
      where: { id: promptId },
    })

    if (!prompt) {
      throw new NotFoundException('Prompt not found')
    }

    return prisma.promptTemplate.update({
      where: { id: promptId },
      data: { rating },
    })
  }

  async toggleFavorite(userId: string, promptId: string): Promise<PromptTemplate> {
    const prompt = await prisma.promptTemplate.findUnique({
      where: { id: promptId },
    })

    if (!prompt) {
      throw new NotFoundException('Prompt not found')
    }

    return prisma.promptTemplate.update({
      where: { id: promptId },
      data: {
        isFavorite: !prompt.isFavorite,
      },
    })
  }
}

export const promptTemplateService = new PromptTemplateService()
