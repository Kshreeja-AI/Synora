import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@synora/database'
import { messageGenerationService } from '../../src/services/messageGeneration.service'
import { conversationService } from '../../src/services/conversation.service'
import { messageService } from '../../src/services/message.service'
import { MessageRole } from '@prisma/client'
import * as aiModule from '../../src/ai/index.js'

describe('MessageGenerationService', () => {
  let workspaceId: string
  let userId: string
  let conversationId: string
  let userMessageId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId,
        role: 'OWNER',
      },
    })

    const conversation = await conversationService.create(userId, workspaceId, {
      title: 'Test Conversation',
      provider: 'anthropic',
      model: 'claude-3-sonnet',
    })
    conversationId = conversation.id

    const userMessage = await messageService.create(userId, conversationId, {
      content: 'Hello, Claude!',
      role: MessageRole.USER,
    })
    userMessageId = userMessage.id

    // Mock the AI provider
    vi.spyOn(aiModule, 'resolveProvider').mockResolvedValue({
      id: 'anthropic',
      capabilities: ['text-generation'],
      generateText: vi.fn().mockResolvedValue({
        text: 'Hello! How can I help you today?',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        usage: { inputTokens: 5, outputTokens: 10 },
      }),
    } as unknown as aiModule.TextGenerationProvider)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { conversationId } })
    await prisma.conversationUsage.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { id: conversationId } })
    await prisma.workspaceMember.deleteMany({ where: { userId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('generateResponseStream', () => {
    it('should generate response tokens from AI provider', async () => {
      const tokens: string[] = []
      for await (const token of messageGenerationService.generateResponseStream(
        userId,
        conversationId,
        userMessageId
      )) {
        tokens.push(token.token)
      }

      expect(tokens.length).toBeGreaterThan(0)
      const content = tokens.join('')
      expect(content).toContain('Hello')
    })

    it('should track input and output tokens correctly', async () => {
      let firstInputTokens: number | undefined
      let lastOutputTokens: number | undefined

      for await (const token of messageGenerationService.generateResponseStream(
        userId,
        conversationId,
        userMessageId
      )) {
        if (token.inputTokens !== undefined) {
          firstInputTokens = token.inputTokens
        }
        if (token.outputTokens !== undefined) {
          lastOutputTokens = token.outputTokens
        }
      }

      expect(firstInputTokens).toBe(5)
      expect(lastOutputTokens).toBe(10)
    })

    it('should create an assistant reply with the generated content, leaving the user message untouched', async () => {
      let assistantMessageId: string | undefined
      for await (const token of messageGenerationService.generateResponseStream(
        userId,
        conversationId,
        userMessageId
      )) {
        if (token.completed) {
          assistantMessageId = token.messageId
        }
      }

      expect(assistantMessageId).toBeDefined()

      const assistantMessage = await prisma.message.findUnique({
        where: { id: assistantMessageId },
      })
      expect(assistantMessage?.role).toBe(MessageRole.ASSISTANT)
      expect(assistantMessage?.parentId).toBe(userMessageId)
      expect(assistantMessage?.content).toContain('Hello')

      // The user's own message must not be mutated by generation.
      const userMessage = await prisma.message.findUnique({
        where: { id: userMessageId },
      })
      expect(userMessage?.role).toBe(MessageRole.USER)
      expect(userMessage?.content).toBe('Hello, Claude!')
    })

    it('should track usage in ConversationUsage', async () => {
      for await (const _token of messageGenerationService.generateResponseStream(
        userId,
        conversationId,
        userMessageId
      )) {
        // Consume the stream
      }

      const usage = await prisma.conversationUsage.findUnique({
        where: { conversationId },
      })

      expect(usage).toBeDefined()
      expect(usage?.inputTokens).toBe(5)
      expect(usage?.outputTokens).toBe(10)
      expect(usage?.totalTokens).toBe(15)
    })

    it('should throw NotFoundException if message not found', async () => {
      const nonExistentMessageId = 'non-existent-id'

      let error: Error | undefined
      try {
        for await (const _token of messageGenerationService.generateResponseStream(
          userId,
          conversationId,
          nonExistentMessageId
        )) {
          // Stream consumer
        }
      } catch (e) {
        error = e as Error
      }

      expect(error).toBeDefined()
      expect(error?.message).toContain('Message not found')
    })

    it('should throw error if message is not USER role', async () => {
      // Create an assistant message
      const assistantMessage = await messageService.create(userId, conversationId, {
        content: 'This is an assistant response',
        role: MessageRole.ASSISTANT,
      })

      let error: Error | undefined
      try {
        for await (const _token of messageGenerationService.generateResponseStream(
          userId,
          conversationId,
          assistantMessage.id
        )) {
          // Stream consumer
        }
      } catch (e) {
        error = e as Error
      }

      expect(error).toBeDefined()
      expect(error?.message).toContain('Can only generate responses for user messages')
    })

    it('should throw NotFoundException if conversation not found', async () => {
      // generateResponseStream validates the conversation before it ever
      // looks at messageId, so there's no need for a real (or orphan)
      // Message row here -- and Message.conversationId has an FK
      // constraint, so a row actually pointing at a non-existent
      // conversation can't be created in the first place.
      let error: Error | undefined
      try {
        for await (const _token of messageGenerationService.generateResponseStream(
          userId,
          'non-existent-conv',
          'non-existent-message'
        )) {
          // Stream consumer
        }
      } catch (e) {
        error = e as Error
      }

      expect(error).toBeDefined()
      expect(error?.message).toContain('Conversation not found')
    })

    it('should check workspace membership', async () => {
      // Create a different user without workspace access
      const otherUser = await prisma.user.create({
        data: {
          email: `other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      let error: Error | undefined
      try {
        for await (const _token of messageGenerationService.generateResponseStream(
          otherUser.id,
          conversationId,
          userMessageId
        )) {
          // Stream consumer
        }
      } catch (e) {
        error = e as Error
      }

      expect(error).toBeDefined()

      // Cleanup
      await prisma.user.delete({ where: { id: otherUser.id } })
    })
  })

  describe('generateResponseFull', () => {
    it('should generate complete response and return updated message', async () => {
      const result = await messageGenerationService.generateResponseFull(
        userId,
        conversationId,
        userMessageId
      )

      expect(result.content).toContain('Hello')
      expect(result.role).toBe(MessageRole.ASSISTANT)
    })

    it('should consume entire stream and return final message', async () => {
      const result = await messageGenerationService.generateResponseFull(
        userId,
        conversationId,
        userMessageId
      )

      const dbMessage = await prisma.message.findUnique({
        where: { id: result.id },
      })

      expect(dbMessage?.content).toBe(result.content)
    })
  })

  describe('regenerateResponse', () => {
    it('should regenerate assistant message using parent user message', async () => {
      // First, generate an assistant response
      const firstResponse = await messageGenerationService.generateResponseFull(
        userId,
        conversationId,
        userMessageId
      )

      // Set as parent for regeneration test
      const userMsg = await prisma.message.findUnique({
        where: { id: userMessageId },
      })
      expect(userMsg?.role).toBe(MessageRole.USER)

      // Now regenerate - we need to provide the assistant message's ID
      // The regenerateResponse expects a message with parentId set to user message
      const regeneratedResponse = await messageGenerationService.regenerateResponse(
        userId,
        conversationId,
        firstResponse.id
      )

      expect(regeneratedResponse.role).toBe(MessageRole.ASSISTANT)
      expect(regeneratedResponse.content).toContain('Hello')
    })

    it('should throw error if message is not ASSISTANT role', async () => {
      let error: Error | undefined
      try {
        await messageGenerationService.regenerateResponse(userId, conversationId, userMessageId)
      } catch (e) {
        error = e as Error
      }

      expect(error).toBeDefined()
      expect(error?.message).toContain('Can only regenerate assistant messages')
    })

    it('should throw error if assistant message has no parent', async () => {
      // Create an orphaned assistant message (no parentId)
      const orphanedAssistant = await prisma.message.create({
        data: {
          id: `msg-orphan-${Date.now()}`,
          conversationId,
          content: 'Orphaned response',
          role: MessageRole.ASSISTANT,
        },
      })

      let error: Error | undefined
      try {
        await messageGenerationService.regenerateResponse(
          userId,
          conversationId,
          orphanedAssistant.id
        )
      } catch (e) {
        error = e as Error
      }

      expect(error).toBeDefined()
      expect(error?.message).toContain('Cannot regenerate orphaned assistant message')

      // Cleanup
      await prisma.message.delete({ where: { id: orphanedAssistant.id } })
    })
  })

  describe('estimateTokens', () => {
    it('should estimate tokens based on character count', () => {
      const content = 'Hello, this is a test message'
      const estimate = messageGenerationService.estimateTokens(content)

      // ~4 characters per token
      expect(estimate).toBeGreaterThan(0)
      expect(estimate).toBeLessThanOrEqual(Math.ceil(content.length / 4) + 1)
    })

    it('should return at least 1 for non-empty content', () => {
      const estimate = messageGenerationService.estimateTokens('Hi')
      expect(estimate).toBeGreaterThanOrEqual(1)
    })

    it('should return 0 for empty content', () => {
      const estimate = messageGenerationService.estimateTokens('')
      expect(estimate).toBe(0)
    })
  })
})
