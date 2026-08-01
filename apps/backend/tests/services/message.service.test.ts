import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { messageService } from '../../src/services/message.service'
import { conversationService } from '../../src/services/conversation.service'
import { MessageRole } from '@prisma/client'

describe('MessageService', () => {
  let workspaceId: string
  let userId: string
  let conversationId: string

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
  })

  afterEach(async () => {
    await prisma.message.deleteMany({ where: { conversationId } })
    await prisma.conversation.deleteMany({ where: { id: conversationId } })
    await prisma.workspaceMember.deleteMany({ where: { userId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('create', () => {
    it('should create a user message', async () => {
      const result = await messageService.create(userId, conversationId, {
        content: 'Hello, world!',
        role: MessageRole.USER,
      })

      expect(result.id).toBeDefined()
      expect(result.content).toBe('Hello, world!')
      expect(result.role).toBe(MessageRole.USER)
    })

    it('should create an assistant message with branch', async () => {
      const result = await messageService.create(userId, conversationId, {
        content: 'Hello! How can I help?',
        role: MessageRole.ASSISTANT,
      })

      expect(result.id).toBeDefined()
      expect(result.role).toBe(MessageRole.ASSISTANT)

      const branch = await prisma.messageBranch.findFirst({
        where: { messageId: result.id },
      })
      expect(branch).toBeDefined()
      expect(branch?.isMainBranch).toBe(true)
    })
  })

  describe('getConversationHistory', () => {
    beforeEach(async () => {
      await messageService.create(userId, conversationId, {
        content: 'Hello',
        role: MessageRole.USER,
      })

      await messageService.create(userId, conversationId, {
        content: 'Hi there!',
        role: MessageRole.ASSISTANT,
      })
    })

    it('should get conversation history', async () => {
      const result = await messageService.getConversationHistory(userId, conversationId)

      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('Hello')
      expect(result[1].content).toBe('Hi there!')
    })

    it('should support pagination', async () => {
      const result = await messageService.getConversationHistory(userId, conversationId, {
        skip: 0,
        take: 1,
      })

      expect(result).toHaveLength(1)
    })
  })

  describe('update', () => {
    let messageId: string

    beforeEach(async () => {
      const msg = await messageService.create(userId, conversationId, {
        content: 'Original content',
        role: MessageRole.USER,
      })
      messageId = msg.id
    })

    it('should update message content', async () => {
      const result = await messageService.update(userId, messageId, {
        content: 'Updated content',
      })

      expect(result.content).toBe('Updated content')
    })
  })

  describe('attachments', () => {
    let messageId: string

    beforeEach(async () => {
      const msg = await messageService.create(userId, conversationId, {
        content: 'Message with attachment',
        role: MessageRole.USER,
      })
      messageId = msg.id
    })

    it('should add attachment', async () => {
      const attachment = await messageService.addAttachment(userId, messageId, {
        url: 'https://example.com/file.pdf',
        mimeType: 'application/pdf',
        name: 'document.pdf',
        size: 1024,
      })

      expect(attachment.messageId).toBe(messageId)
      expect(attachment.name).toBe('document.pdf')
    })
  })
})
