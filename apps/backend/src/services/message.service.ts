import { prisma } from '@synora/database'
import { Message, MessageBranch, MessageRole, MessageAttachment } from '@prisma/client'
import { NotFoundException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requirePermission } from './permissions'
import { requireMembership } from './checks'
import { enqueueGenerateResponse } from '../workers/queue'

export interface CreateMessageInput {
  content: string
  role: MessageRole
  parentId?: string
  fileIds?: string[]
}

export interface UpdateMessageInput {
  content?: string
}

/**
 * A message plus the sibling metadata the client needs to render fork
 * navigation ("< 2 of 3 >") inline, without a second round-trip.
 *
 * `siblingCount` is total alternatives at this fork (including self);
 * `siblingIndex` is this message's 0-based position among them, ordered
 * by createdAt. Both are 1/0 for a leaf that has no siblings.
 */
export type LinearizedMessage = Message & {
  branch: MessageBranch | null
  attachments: MessageAttachment[]
  siblingCount: number
  siblingIndex: number
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

    logger.debug(`[messageService.create] Creating ${input.role} message for conversation ${conversationId}`)

    // If fileIds provided, fetch the files to attach them
    let attachmentData: Array<{ url: string; mimeType: string; name: string; size: number }> = []
    if (input.fileIds && input.fileIds.length > 0) {
      const files = await prisma.conversationFile.findMany({
        where: {
          id: { in: input.fileIds },
          conversationId, // Ensure files belong to this conversation
        },
      })

      attachmentData = files.map((file) => ({
        url: `/files/${file.storageKey}`,
        mimeType: file.mimeType,
        name: file.fileName,
        size: file.fileSize,
      }))
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        content: input.content,
        role: input.role,
        parentId: input.parentId,
        attachments: {
          create: attachmentData,
        },
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

    logger.debug(`[messageService.create] Created message ${message.id} (${input.role}) with ${attachmentData.length} attachments`)
    return message
  }

  async createPlaceholder(conversationId: string, role: MessageRole, parentId?: string): Promise<Message> {
    const message = await prisma.message.create({
      data: {
        conversationId,
        content: '', // Empty until generation completes
        role,
        parentId,
      },
      include: {
        branch: true,
        children: true,
        attachments: true,
      },
    })

    logger.debug(`[messageService.createPlaceholder] Created placeholder message ${message.id} (${role})`)
    return message
  }

  async enqueueGeneration(conversationId: string, userMessage: Message, assistantMessage: Message, userId: string): Promise<void> {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      })

      if (!conversation) {
        throw new NotFoundException('Conversation not found')
      }

      // Create a streaming job record for tracking. The messageId link is
      // what the SSE endpoint uses to locate the job for this message
      // (see routes/streaming.ts findFirst({ where: { messageId } })).
      const job = await prisma.streamingJob.create({
        data: {
          conversationId,
          messageId: assistantMessage.id,
          status: 'RUNNING',
        },
      })

      // Enqueue the generation job on the shared singleton producer —
      // constructing a Queue per send leaked a Redis connection per
      // message.
      await enqueueGenerateResponse({
        jobId: job.id,
        conversationId,
        messageId: assistantMessage.id,
        userId,
        provider: conversation.provider,
        model: conversation.model,
      })

      logger.info(`[messageService.enqueueGeneration] Enqueued generation job ${job.id}`, {
        conversationId,
        assistantMessageId: assistantMessage.id,
      })
    } catch (error) {
      logger.error('[messageService.enqueueGeneration] Failed to enqueue generation', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't throw - let the placeholder message stay so user knows something happened
    }
  }

  /**
   * Regenerate an assistant response for a given assistant message.
   * Wipes the message content, creates a fresh streaming job, and enqueues
   * generation. The client can re-subscribe to the SSE stream using the
   * same messageId. Returns the reset message.
   */
  async regenerate(userId: string, messageId: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    if (message.role !== MessageRole.ASSISTANT) {
      throw new NotFoundException('Only assistant messages can be regenerated')
    }

    const membership = await requireMembership(userId, message.conversation.workspaceId)
    requirePermission(membership.role, 'message:send')

    // Clear the existing message so the stream restarts from empty
    const reset = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: '',
        inputTokens: 0,
        outputTokens: 0,
      },
    })

    // Detach any prior streaming job so the messageId unique link is free
    await prisma.streamingJob.updateMany({
      where: { messageId },
      data: { messageId: null, status: 'CANCELED', completedAt: new Date() },
    })

    // Find the user message that preceded this assistant message
    const parentUserMessage = message.parentId
      ? await prisma.message.findUnique({ where: { id: message.parentId } })
      : null

    if (!parentUserMessage) {
      throw new NotFoundException('Parent user message not found')
    }

    await this.enqueueGeneration(message.conversationId, parentUserMessage, reset, userId)
    return reset
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

  /**
   * Return the canonical linearized path through the conversation.
   *
   * A conversation is a DAG — every message has an optional parent, and a
   * parent can have multiple children (alternative branches). The UI
   * renders one path through that DAG at a time. That path is chosen at
   * each fork by picking the child whose MessageBranch record is marked
   * `isMainBranch`; if no child is explicitly marked main (which is the
   * normal case in an unbranched conversation — we only create branch
   * records when there's actually a fork), we pick the earliest-created
   * child. Every returned message carries `siblingCount` and
   * `siblingIndex` so the client can render fork-navigation controls
   * without a second round-trip.
   *
   * Pagination (skip/take) applies to the linearized path, not the raw
   * message set: after linearization, take a window from it.
   */
  async getConversationHistory(
    userId: string,
    conversationId: string,
    options?: { skip?: number; take?: number }
  ): Promise<LinearizedMessage[]> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    await requireMembership(userId, conversation.workspaceId)

    const all = await prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: {
        branch: true,
        attachments: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const linearized = linearizeCanonicalPath(all)

    const skip = options?.skip ?? 0
    const take = options?.take ?? 100
    return linearized.slice(skip, skip + take)
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
      logger.debug(`[messageService.delete] Message ${id} already soft-deleted, returning`)
      return message
    }

    logger.info(`[messageService.delete] Soft-deleting message ${id} from conversation ${message.conversationId}`)
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

  async pinMessage(userId: string, messageId: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const membership = await requireMembership(userId, message.conversation.workspaceId)
    requirePermission(membership.role, 'message:manage')

    logger.debug(`[messageService.pinMessage] Pinning message ${messageId}`)
    return prisma.message.update({
      where: { id: messageId },
      data: { isPinned: true },
    })
  }

  async unpinMessage(userId: string, messageId: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    const membership = await requireMembership(userId, message.conversation.workspaceId)
    requirePermission(membership.role, 'message:manage')

    logger.debug(`[messageService.unpinMessage] Unpinning message ${messageId}`)
    return prisma.message.update({
      where: { id: messageId },
      data: { isPinned: false },
    })
  }
}

export const messageService = new MessageService()

type MessageWithBranch = Message & {
  branch: MessageBranch | null
  attachments: MessageAttachment[]
}

/**
 * Walk a conversation's message set and return the canonical path from
 * root(s) to leaf: at each fork, take the child marked `isMainBranch`,
 * or (if no child is marked) the earliest-created child. Every returned
 * message is enriched with `siblingCount`/`siblingIndex` measured
 * against its full sibling set, so the client can render a fork
 * indicator inline.
 *
 * Exported for unit-testing without touching Postgres.
 */
export function linearizeCanonicalPath(all: MessageWithBranch[]): LinearizedMessage[] {
  const childrenByParent = new Map<string | null, MessageWithBranch[]>()
  for (const m of all) {
    const key = m.parentId ?? null
    const list = childrenByParent.get(key)
    if (list) {
      list.push(m)
    } else {
      childrenByParent.set(key, [m])
    }
  }

  // Prisma already ordered by createdAt asc; make it explicit so the
  // canonical choice ("earliest child") is stable even if this helper is
  // called with a set that wasn't pre-sorted.
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  const pickCanonical = (siblings: MessageWithBranch[]): MessageWithBranch => {
    const explicitMain = siblings.find((s) => s.branch?.isMainBranch)
    return explicitMain ?? siblings[0]
  }

  const enrich = (m: MessageWithBranch, siblings: MessageWithBranch[]): LinearizedMessage => ({
    ...m,
    siblingCount: siblings.length,
    siblingIndex: siblings.findIndex((s) => s.id === m.id),
  })

  const path: LinearizedMessage[] = []
  const roots = childrenByParent.get(null) ?? []
  // A conversation *should* have exactly one root, but system + first
  // user message occasionally both have no parent — walk each root's
  // subtree and concatenate them in root-order so we never silently drop
  // one.
  for (const root of roots) {
    let current: MessageWithBranch | undefined = root
    let currentSiblings = roots
    while (current) {
      path.push(enrich(current, currentSiblings))
      const children = childrenByParent.get(current.id) ?? []
      if (children.length === 0) break
      const chosen = pickCanonical(children)
      current = chosen
      currentSiblings = children
    }
  }
  return path
}
