import { prisma } from '@synora/database'
import { Message, MessageRole } from '@prisma/client'
import { NotFoundException, ForbiddenException } from '@synora/shared'
import { logger } from '../utils/logger'
import { resolveProvider, type ConversationMessage } from '../ai/index.js'
import { conversationUsageService } from './conversationUsage.service'

const PROMPT_HISTORY_WINDOW = 50
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [500, 1500]

export interface StreamToken {
  token: string
  inputTokens?: number
  outputTokens?: number
  completed?: boolean
  messageId?: string
}

/**
 * Message Generation Service
 * Handles streaming message generation with token-by-token yielding.
 * Supports regeneration of assistant messages.
 */
export class MessageGenerationService {
  /**
   * Generate response stream - yields tokens as they arrive
   */
  async *generateResponseStream(
    userId: string,
    conversationId: string,
    messageId: string
  ): AsyncGenerator<StreamToken, void, unknown> {
    logger.info(`[generateResponseStream] Starting for message ${messageId} in conversation ${conversationId}`)

    // Validate conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    // Check workspace membership
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
    })
    if (!member) {
      throw new ForbiddenException('Not a member of this workspace')
    }

    // Validate message exists and is USER role
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    })
    if (!message) {
      throw new NotFoundException('Message not found')
    }
    if (message.role !== MessageRole.USER) {
      throw new Error('Can only generate responses for user messages')
    }

    // Build context and get provider
    const history = await this.buildPromptContext(conversationId, messageId)
    const provider = await resolveProvider('text-generation', {
      explicitProviderId: conversation.provider,
    })

    let inputTokens = 0
    let outputTokens = 0
    let fullContent = ''

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        logger.debug(`[generateResponseStream] Attempt ${attempt} of ${MAX_ATTEMPTS}`)

        // Call provider with streaming
        const result = await provider.generateText({
          prompt: message.content,
          messages: history,
          model: conversation.model,
        })

        inputTokens = result.usage?.inputTokens ?? 0
        outputTokens = result.usage?.outputTokens ?? 0
        fullContent = result.text

        // Yield tokens
        const tokens = result.text.split(' ')
        for (const token of tokens) {
          yield {
            token: token + ' ',
            inputTokens: inputTokens > 0 ? inputTokens : undefined,
            outputTokens: outputTokens > 0 ? outputTokens : undefined,
          }
        }

        // Create the assistant's reply as its own message, parented to the
        // user message that triggered it. This used to `update` the user
        // message's own row with the generated content instead of creating
        // a reply, which silently overwrote the user's message and left it
        // permanently mislabeled with role: USER.
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId,
            content: fullContent,
            role: MessageRole.ASSISTANT,
            parentId: messageId,
          },
        })

        // Record usage
        await conversationUsageService.recordGeneration({
          conversationId,
          model: conversation.model,
          inputTokens,
          outputTokens,
        })

        yield {
          token: '',
          completed: true,
          inputTokens,
          outputTokens,
          messageId: assistantMessage.id,
        }
        logger.info(`[generateResponseStream] Completed on attempt ${attempt}`, {
          messageId,
          assistantMessageId: assistantMessage.id,
          inputTokens,
          outputTokens,
        })
        return
      } catch (error) {
        lastError = error
        logger.warn(`[generateResponseStream] Attempt ${attempt} failed`, {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        })

        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = RETRY_BACKOFF_MS[attempt - 1]
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /**
   * Generate response and return full message
   */
  async generateResponseFull(
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<Message> {
    logger.info(`[generateResponseFull] Starting for message ${messageId}`)

    // Consume the entire stream and capture the id of the assistant message
    // it created (see the `completed` token in generateResponseStream).
    let assistantMessageId: string | undefined
    for await (const token of this.generateResponseStream(userId, conversationId, messageId)) {
      if (token.completed) {
        assistantMessageId = token.messageId
      }
    }

    if (!assistantMessageId) {
      throw new Error('generateResponseStream completed without producing a message id')
    }

    // Return the newly created assistant message, not the triggering one.
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: assistantMessageId },
    })

    return message
  }

  /**
   * Regenerate an assistant message by re-running generation on its parent
   */
  async regenerateResponse(
    userId: string,
    conversationId: string,
    assistantMessageId: string
  ): Promise<Message> {
    logger.info(`[regenerateResponse] Regenerating message ${assistantMessageId}`)

    // Validate message is assistant
    const message = await prisma.message.findUnique({
      where: { id: assistantMessageId },
    })
    if (!message) {
      throw new NotFoundException('Message not found')
    }
    if (message.role !== MessageRole.ASSISTANT) {
      throw new Error('Can only regenerate assistant messages')
    }
    if (!message.parentId) {
      throw new Error('Cannot regenerate orphaned assistant message')
    }

    // Generate new response based on parent user message
    const newMessage = await this.generateResponseFull(userId, conversationId, message.parentId)
    return newMessage
  }

  /**
   * Estimate tokens in content (rough approximation: ~4 chars per token)
   */
  estimateTokens(content: string): number {
    if (!content) return 0
    // Rough estimate: 1 token per 4 characters
    return Math.max(1, Math.ceil(content.length / 4))
  }

  /**
   * Build prompt context from conversation history
   */
  private async buildPromptContext(
    conversationId: string,
    excludeMessageId: string
  ): Promise<ConversationMessage[]> {
    const recentMessages = await prisma.message.findMany({
      where: { conversationId, deletedAt: null, id: { not: excludeMessageId } },
      orderBy: { createdAt: 'desc' },
      take: PROMPT_HISTORY_WINDOW,
    })

    return recentMessages.reverse().map((message) => ({
      role:
        message.role === MessageRole.ASSISTANT
          ? 'assistant'
          : message.role === MessageRole.SYSTEM
            ? 'system'
            : 'user',
      content: message.content,
    }))
  }
}

export const messageGenerationService = new MessageGenerationService()
