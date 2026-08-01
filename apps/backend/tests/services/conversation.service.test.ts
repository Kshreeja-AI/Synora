import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { conversationService } from '../../src/services/conversation.service'

describe('ConversationService', () => {
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
  })

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { userId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('create', () => {
    it('should create a conversation', async () => {
      const result = await conversationService.create(userId, workspaceId, {
        title: 'Test Conversation',
        description: 'A test conversation',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      })

      expect(result.id).toBeDefined()
      expect(result.title).toBe('Test Conversation')
      expect(result.provider).toBe('anthropic')
      expect(result.workspaceId).toBe(workspaceId)
    })
  })

  describe('getById', () => {
    beforeEach(async () => {
      const conv = await conversationService.create(userId, workspaceId, {
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      })
      conversationId = conv.id
    })

    it('should get conversation by id', async () => {
      const result = await conversationService.getById(userId, conversationId)

      expect(result).toBeDefined()
      expect(result?.id).toBe(conversationId)
      expect(result?.title).toBe('Test Conversation')
    })

    it('should return null for non-existent id', async () => {
      const result = await conversationService.getById(userId, 'non-existent')
      expect(result).toBeNull()
    })
  })

  describe('listByWorkspace', () => {
    beforeEach(async () => {
      await conversationService.create(userId, workspaceId, {
        title: 'Conversation 1',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      })

      await conversationService.create(userId, workspaceId, {
        title: 'Conversation 2',
        provider: 'openai',
        model: 'gpt-4',
      })
    })

    it('should list conversations by workspace', async () => {
      const result = await conversationService.listByWorkspace(userId, workspaceId, {})

      expect(result.conversations).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should support pagination', async () => {
      const result = await conversationService.listByWorkspace(userId, workspaceId, {
        skip: 0,
        take: 1,
      })

      expect(result.conversations).toHaveLength(1)
      expect(result.total).toBe(2)
    })

    it('should support search', async () => {
      const result = await conversationService.listByWorkspace(userId, workspaceId, {
        search: 'Conversation 1',
      })

      expect(result.conversations).toHaveLength(1)
      expect(result.conversations[0].title).toBe('Conversation 1')
    })
  })

  describe('update', () => {
    beforeEach(async () => {
      const conv = await conversationService.create(userId, workspaceId, {
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      })
      conversationId = conv.id
    })

    it('should update conversation', async () => {
      const result = await conversationService.update(userId, conversationId, {
        title: 'Updated Title',
        model: 'claude-3-opus',
      })

      expect(result.title).toBe('Updated Title')
      expect(result.model).toBe('claude-3-opus')
    })
  })

  describe('archive/restore', () => {
    beforeEach(async () => {
      const conv = await conversationService.create(userId, workspaceId, {
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      })
      conversationId = conv.id
    })

    it('should archive conversation', async () => {
      const result = await conversationService.archive(userId, conversationId)
      expect(result.isArchived).toBe(true)
    })

    it('should restore conversation', async () => {
      await conversationService.archive(userId, conversationId)
      const result = await conversationService.restore(userId, conversationId)
      expect(result.isArchived).toBe(false)
    })
  })
})
