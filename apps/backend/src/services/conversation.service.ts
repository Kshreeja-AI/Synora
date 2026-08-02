import { prisma } from '@synora/database'
import { Conversation, ConversationStatus, Prisma } from '@prisma/client'
import { NotFoundException, ValidationException } from '@synora/shared'
import { requirePermission } from './permissions'
import { requireMembership } from './checks'
import { recordAuditEvent } from './audit.service'
import { getProviderDescriptor } from '../ai'

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
  tagNames?: string[]
}

export type ConversationSortField = 'createdAt' | 'updatedAt' | 'lastMessageAt' | 'title'
export type SortDirection = 'asc' | 'desc'

export interface ListConversationsOptions {
  archived?: boolean
  pinned?: boolean
  skip?: number
  take?: number
  search?: string
  sortBy?: ConversationSortField
  sortDirection?: SortDirection
}

const MAX_TAGS_PER_CONVERSATION = 20

export class ConversationService {
  async create(userId: string, workspaceId: string, input: CreateConversationInput): Promise<Conversation> {
    const membership = await requireMembership(userId, workspaceId)
    requirePermission(membership.role, 'conversation:create')

    await this.validateProvider(input.provider)

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: input.title,
        description: input.description,
        provider: input.provider,
        model: input.model,
        status: ConversationStatus.ACTIVE,
      },
    })

    await recordAuditEvent(workspaceId, userId, 'conversation_created', 'CONVERSATION', conversation.id, {
      title: conversation.title,
      provider: conversation.provider,
    })

    return conversation
  }

  async getById(userId: string, id: string): Promise<Conversation | null> {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          where: { deletedAt: null },
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

    await requireMembership(userId, conversation.workspaceId)

    return conversation
  }

  async listByWorkspace(userId: string, workspaceId: string, options: ListConversationsOptions): Promise<{
    conversations: Conversation[]
    total: number
  }> {
    await requireMembership(userId, workspaceId)

    const where: Prisma.ConversationWhereInput = {
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

    const sortBy = options.sortBy ?? 'lastMessageAt'
    const sortDirection = options.sortDirection ?? 'desc'

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { [sortBy]: sortDirection },
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

  /**
   * Metadata only — title, description, provider, model, tags. Lifecycle
   * transitions (archive/restore/delete) and pin state each have their own
   * dedicated method below and are deliberately not reachable through this
   * generic update, so the state machine in
   * M2_IMPLEMENTATION_PLAN.md §5 can't be bypassed by a client PATCHing
   * `isArchived`/`isPinned`/`status` directly.
   */
  async update(userId: string, id: string, input: UpdateConversationInput): Promise<Conversation> {
    const conversation = await this.requireManageable(userId, id)

    if (input.provider) {
      await this.validateProvider(input.provider)
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        ...(input.title && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.provider && { provider: input.provider }),
        ...(input.model && { model: input.model }),
        ...(input.tagNames && {
          tags: { set: await this.resolveTags(conversation.workspaceId, input.tagNames) },
        }),
      },
      include: { tags: true },
    })

    return updated
  }

  async archive(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.requireManageable(userId, id)

    if (conversation.status !== ConversationStatus.ACTIVE) {
      throw new ValidationException(
        `Cannot archive a conversation with status ${conversation.status} — only ACTIVE conversations can be archived.`
      )
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.ARCHIVED, isArchived: true },
    })

    await recordAuditEvent(conversation.workspaceId, userId, 'conversation_archived', 'CONVERSATION', id)
    return updated
  }

  async restore(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.requireManageable(userId, id)

    if (conversation.status !== ConversationStatus.ARCHIVED) {
      throw new ValidationException(
        `Cannot restore a conversation with status ${conversation.status} — only ARCHIVED conversations can be restored.`
      )
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.ACTIVE, isArchived: false },
    })

    await recordAuditEvent(conversation.workspaceId, userId, 'conversation_restored', 'CONVERSATION', id)
    return updated
  }

  async pin(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.requireManageable(userId, id)
    const updated = await prisma.conversation.update({ where: { id }, data: { isPinned: true } })
    await recordAuditEvent(conversation.workspaceId, userId, 'conversation_pinned', 'CONVERSATION', id)
    return updated
  }

  async unpin(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.requireManageable(userId, id)
    const updated = await prisma.conversation.update({ where: { id }, data: { isPinned: false } })
    await recordAuditEvent(conversation.workspaceId, userId, 'conversation_unpinned', 'CONVERSATION', id)
    return updated
  }

  async delete(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.requireManageable(userId, id)

    if (conversation.status === ConversationStatus.DELETED) {
      return conversation
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.DELETED },
    })

    await recordAuditEvent(conversation.workspaceId, userId, 'conversation_deleted', 'CONVERSATION', id)
    return updated
  }

  /** Shared existence + workspace-membership + permission check used by
   * every mutating method above — one place enforcing "you must be a
   * member with conversation:manage to touch this conversation." Uses the
   * same shared `requireMembership` (404 on non-member) every other
   * service in this codebase uses — not a locally reimplemented check. */
  private async requireManageable(userId: string, id: string): Promise<Conversation> {
    const conversation = await prisma.conversation.findUnique({ where: { id } })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const membership = await requireMembership(userId, conversation.workspaceId)
    requirePermission(membership.role, 'conversation:manage')

    return conversation
  }

  /** A conversation's provider must name a registered, currently-configured
   * descriptor — otherwise it could never generate a reply. Model is
   * intentionally not validated against a fixed list: models are free-form
   * per-provider config strings throughout this codebase (see
   * ai/types.ts), and a fixed enum here would contradict that. */
  private async validateProvider(provider: string): Promise<void> {
    const descriptor = getProviderDescriptor(provider)
    if (!descriptor) {
      throw new ValidationException(`"${provider}" is not a known AI provider.`)
    }
    if (!descriptor.capabilities.includes('text-generation')) {
      throw new ValidationException(`Provider "${provider}" does not support text generation.`)
    }
    if (!(await descriptor.isConfigured())) {
      throw new ValidationException(
        `Provider "${provider}" is not configured on this server — its required API key/secret is missing.`
      )
    }
  }

  private async resolveTags(workspaceId: string, tagNames: string[]) {
    if (tagNames.length > MAX_TAGS_PER_CONVERSATION) {
      throw new ValidationException(`A conversation may have at most ${MAX_TAGS_PER_CONVERSATION} tags.`)
    }

    const uniqueNames = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))]

    return Promise.all(
      uniqueNames.map((name) =>
        prisma.conversationTag.upsert({
          where: { workspaceId_name: { workspaceId, name } },
          create: { workspaceId, name },
          update: {},
        })
      )
    )
  }

  async generateTitle(userId: string, conversationId: string): Promise<Conversation> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
      },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const membership = await requireMembership(userId, conversation.workspaceId)
    requirePermission(membership.role, 'conversation:manage')

    // Extract message content for title generation
    const messageContent = conversation.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 1000) // Limit to first 1000 chars

    if (!messageContent.trim()) {
      // Default title if no messages
      return conversation
    }

    // Generate title using the conversation's configured provider
    const { generateText } = await import('../ai')
    try {
      const result = await generateText({
        prompt: `Based on this conversation, generate a concise 5-10 word title. Reply with ONLY the title, no punctuation.\n\n${messageContent}`,
        model: conversation.model,
        maxTokens: 20,
      })

      const title = result.text || ''
      const cleanTitle = title
        .trim()
        .replace(/^["']|["']$/g, '') // Remove quotes
        .slice(0, 100) // Max 100 chars

      return prisma.conversation.update({
        where: { id: conversationId },
        data: { title: cleanTitle || 'Untitled Conversation' },
      })
    } catch {
      // If title generation fails, return conversation unchanged
      // (better to have auto-title fail gracefully than block the user)
      return conversation
    }
  }
}

export const conversationService = new ConversationService()
