import { prisma } from '@synora/database'
import { Message, MessageRole } from '@prisma/client'
import { NotFoundException } from '@synora/shared'
import { generateText, type TextGenerationRequest } from '../ai'
import { logger } from '../utils/logger'
import { requireMembership } from './checks'

interface StreamToken {
  token: string
  inputTokens?: number
  outputTokens?: number
}

export class MessageGenerationService {
  /**
   * Generate an AI response for a user message in a conversation.
   * Returns an async generator that yields tokens as they arrive.
   */
  async *generateResponseStream(
    userId: string,
    conversationId: string,
    messageId: string
  ): AsyncGenerator<StreamToken> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    if (message.role !== MessageRole.USER) {
      throw new Error('Can only generate responses for user messages')
    }

    const conversation = message.conversation
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    await requireMembership(userId, conversation.workspaceId)

    // Fetch conversation history for context (excluding current message)
    const history = await prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        createdAt: { lt: message.createdAt },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        content: true,
        role: true,
      },
    })

    // Build the prompt context
    const conversationMessages = history.map(m => ({
      role: m.role === MessageRole.USER ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }))

    // Add the current user message
    conversationMessages.push({
      role: 'user' as const,
      content: message.content,
    })

    const request: TextGenerationRequest = {
      prompt: message.content,
      model: conversation.model,
      systemPrompt: conversation.description || undefined,
      messages: conversationMessages.slice(-10), // Last 10 messages for context window
    }

    let fullContent = ''
    let inputTokens = 0
    let outputTokens = 0

    try {
      logger.info(`[messageGenerationService.generateResponseStream] Starting generation for message ${messageId}`)

      // Call AI provider and stream the result
      const result = await generateText(request)

      fullContent = result.text
      inputTokens = result.usage?.inputTokens || 0
      outputTokens = result.usage?.outputTokens || 0

      // Yield tokens from the generated content (simulating streaming)
      // In a real implementation, the provider SDK would stream individual tokens
      const words = fullContent.split(/(\s+)/)
      let tokenCount = 0
      for (const word of words) {
        if (word && word.trim()) {
          tokenCount++
          yield {
            token: word,
            inputTokens: tokenCount === 1 ? inputTokens : undefined,
            outputTokens: tokenCount === words.filter(w => w.trim()).length ? outputTokens : undefined,
          }
        } else if (word === ' ') {
          yield { token: ' ' }
        }
      }

      // Update the message with generated content
      await prisma.message.update({
        where: { id: messageId },
        data: {
          content: fullContent,
        },
      })

      // Track usage
      const totalTokens = inputTokens + outputTokens
      await prisma.conversationUsage.upsert({
        where: { conversationId },
        create: {
          conversationId,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCost: 0, // Will be calculated by billing service
        },
        update: {
          inputTokens: { increment: inputTokens },
          outputTokens: { increment: outputTokens },
          totalTokens: { increment: totalTokens },
        },
      })

      logger.info(
        `[messageGenerationService.generateResponseStream] Completed generation for message ${messageId} (${inputTokens} input, ${outputTokens} output tokens)`
      )
    } catch (error) {
      logger.error(`[messageGenerationService.generateResponseStream] Generation failed for message ${messageId}`, { error })

      // Mark message as failed
      await prisma.message.update({
        where: { id: messageId },
        data: {
          content: `[Error generating response: ${error instanceof Error ? error.message : 'Unknown error'}]`,
        },
      })

      throw error
    }
  }

  /**
   * Generate a response and consume all tokens, storing the full result.
   */
  async generateResponseFull(userId: string, conversationId: string, messageId: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    if (message.role !== MessageRole.USER) {
      throw new Error('Can only generate responses for user messages')
    }

    await requireMembership(userId, message.conversation.workspaceId)

    // Consume the stream to generate the full response
    for await (const _token of this.generateResponseStream(userId, conversationId, messageId)) {
      // draining the stream persists the message; no per-token handling needed here
    }

    // Return the updated message
    const updated = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!updated) {
      throw new NotFoundException('Message not found after generation')
    }

    return updated
  }

  /**
   * Regenerate an existing assistant response.
   */
  async regenerateResponse(userId: string, conversationId: string, messageId: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    if (message.role !== MessageRole.ASSISTANT) {
      throw new Error('Can only regenerate assistant messages')
    }

    await requireMembership(userId, message.conversation.workspaceId)

    // Find the parent user message
    if (!message.parentId) {
      throw new Error('Cannot regenerate orphaned assistant message')
    }

    // Generate a new response using the parent user message as context
    return this.generateResponseFull(userId, conversationId, message.parentId)
  }

  /**
   * Get the estimated token count for a message without calling the AI provider.
   * This is a rough estimate: ~4 characters per token for English.
   */
  estimateTokens(content: string): number {
    return Math.ceil(content.length / 4)
  }
}

export const messageGenerationService = new MessageGenerationService()
