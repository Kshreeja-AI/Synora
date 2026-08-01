import { prisma } from '@synora/database'
import { Message, MessageRole, MessageAttachment } from '@prisma/client'
import { NotFoundException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requirePermission } from './permissions'
import { requireMembership } from './checks'
import { createGenerateResponseQueue } from '../workers/generateResponse.worker'

export interface CreateMessageInput {
  content: string
  role: MessageRole
  parentId?: string
  fileIds?: string[]
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

      // Enqueue the generation job
      const queue = createGenerateResponseQueue()
      await queue.add('generate-response', {
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
}

export const messageService = new MessageService()
