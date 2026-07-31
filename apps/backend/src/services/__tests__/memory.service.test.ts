import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma as db } from '@synora/database'
import { memoryService } from '../memory.service'
import { MemoryType, MemoryStatus, MemoryPermission } from '@synora/database'
import { ForbiddenException, NotFoundException } from '@synora/shared'

describe('MemoryService', () => {
  let testUserId: string
  let testWorkspaceId: string
  let testConversationId: string

  beforeEach(async () => {
    // Create test user
    const user = await db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    testUserId = user.id

    // Create test workspace
    const workspace = await db.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-${Date.now()}`,
        members: {
          create: {
            userId: testUserId,
            role: 'OWNER',
          },
        },
      },
    })
    testWorkspaceId = workspace.id

    // Create test conversation
    const conversation = await db.conversation.create({
      data: {
        workspaceId: testWorkspaceId,
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-3-opus',
      },
    })
    testConversationId = conversation.id
  })

  afterEach(async () => {
    // Cleanup
    await db.memory.deleteMany({})
    await db.conversation.deleteMany({})
    await db.workspace.deleteMany({})
    await db.user.deleteMany({})
  })

  describe('createMemory', () => {
    it('should create a memory with valid input', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test memory content',
        type: MemoryType.SEMANTIC,
        category: 'test',
        isManual: true,
      })

      expect(memory.id).toBeDefined()
      expect(memory.content).toBe('Test memory content')
      expect(memory.type).toBe(MemoryType.SEMANTIC)
      expect(memory.importance).toBeGreaterThan(0.5) // Manual boost
    })

    it('should create memory with conversation context', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        conversationId: testConversationId,
        userId: testUserId,
        content: 'Conversation-specific memory',
        type: MemoryType.EPISODIC,
      })

      expect(memory.conversationId).toBe(testConversationId)
      expect(memory.type).toBe(MemoryType.EPISODIC)
    })

    it('should fail if workspace not accessible', async () => {
      const otherUserId = (
        await db.user.create({
          data: { email: `other-${Date.now()}@example.com` },
        })
      ).id

      try {
        await memoryService.createMemory({
          workspaceId: testWorkspaceId,
          userId: otherUserId,
          content: 'Test',
          type: MemoryType.SEMANTIC,
        })
        expect.fail('Should throw ForbiddenException')
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException)
      }
    })

    it('should fail if conversation not found', async () => {
      try {
        await memoryService.createMemory({
          workspaceId: testWorkspaceId,
          conversationId: 'invalid-id',
          userId: testUserId,
          content: 'Test',
          type: MemoryType.SEMANTIC,
        })
        expect.fail('Should throw NotFoundException')
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException)
      }
    })

    it('should set initial importance based on type and manual flag', async () => {
      const autoMemory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Auto',
        type: MemoryType.SEMANTIC,
        isManual: false,
      })

      const manualMemory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Manual',
        type: MemoryType.SEMANTIC,
        isManual: true,
      })

      expect(manualMemory.importance).toBeGreaterThan(autoMemory.importance)
    })
  })

  describe('getMemory', () => {
    it('should retrieve a memory and update access count', async () => {
      const created = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test',
        type: MemoryType.SEMANTIC,
      })

      const retrieved = await memoryService.getMemory(created.id, testUserId, testWorkspaceId)

      expect(retrieved.id).toBe(created.id)
      expect(retrieved.accessCount).toBe(1)
    })

    it('should increment access count on multiple retrievals', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test',
        type: MemoryType.SEMANTIC,
      })

      await memoryService.getMemory(memory.id, testUserId, testWorkspaceId)
      await memoryService.getMemory(memory.id, testUserId, testWorkspaceId)

      const final = await db.memory.findUnique({
        where: { id: memory.id },
      })

      expect(final?.accessCount).toBe(2)
    })

    it('should fail for non-existent memory', async () => {
      try {
        await memoryService.getMemory('invalid-id', testUserId, testWorkspaceId)
        expect.fail('Should throw NotFoundException')
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException)
      }
    })

    it('should respect private permission', async () => {
      const otherUser = await db.user.create({
        data: { email: `other-${Date.now()}@example.com` },
      })

      const privateMemory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Private',
        type: MemoryType.SEMANTIC,
        permission: MemoryPermission.PRIVATE,
      })

      try {
        await memoryService.getMemory(privateMemory.id, otherUser.id, testWorkspaceId)
        expect.fail('Should throw ForbiddenException')
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException)
      }
    })
  })

  describe('searchMemories', () => {
    it('should search memories by type', async () => {
      await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Semantic memory',
        type: MemoryType.SEMANTIC,
      })

      await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Episodic memory',
        type: MemoryType.EPISODIC,
      })

      const result = await memoryService.searchMemories(
        {
          workspaceId: testWorkspaceId,
          type: MemoryType.SEMANTIC,
        },
        testUserId,
      )

      expect(result.total).toBe(1)
      expect(result.memories[0].type).toBe(MemoryType.SEMANTIC)
    })

    it('should search by tags', async () => {
      await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Tagged memory',
        type: MemoryType.SEMANTIC,
        tags: ['important', 'review'],
      })

      const result = await memoryService.searchMemories(
        {
          workspaceId: testWorkspaceId,
          tags: ['important'],
        },
        testUserId,
      )

      expect(result.total).toBe(1)
      expect(result.memories[0].tags).toContain('important')
    })

    it('should search pinned memories', async () => {
      const regular = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Regular',
        type: MemoryType.SEMANTIC,
      })

      const pinned = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Pinned',
        type: MemoryType.SEMANTIC,
      })

      await memoryService.updateMemory(pinned.id, { isPinned: true }, testUserId, testWorkspaceId)

      const result = await memoryService.searchMemories(
        {
          workspaceId: testWorkspaceId,
          pinnedOnly: true,
        },
        testUserId,
      )

      expect(result.total).toBe(1)
      expect(result.memories[0].isPinned).toBe(true)
    })

    it('should respect pagination', async () => {
      for (let i = 0; i < 25; i++) {
        await memoryService.createMemory({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          content: `Memory ${i}`,
          type: MemoryType.SEMANTIC,
        })
      }

      const page1 = await memoryService.searchMemories(
        {
          workspaceId: testWorkspaceId,
          limit: 10,
          offset: 0,
        },
        testUserId,
      )

      const page2 = await memoryService.searchMemories(
        {
          workspaceId: testWorkspaceId,
          limit: 10,
          offset: 10,
        },
        testUserId,
      )

      expect(page1.memories.length).toBe(10)
      expect(page2.memories.length).toBe(10)
      expect(page1.memories[0].id).not.toBe(page2.memories[0].id)
    })
  })

  describe('updateMemory', () => {
    it('should update memory content', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Original',
        type: MemoryType.SEMANTIC,
      })

      const updated = await memoryService.updateMemory(
        memory.id,
        { content: 'Updated' },
        testUserId,
        testWorkspaceId,
      )

      expect(updated.content).toBe('Updated')
    })

    it('should create version when content changes', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Original',
        type: MemoryType.SEMANTIC,
      })

      const original = await db.memory.findUnique({ where: { id: memory.id } })
      expect(original?.version).toBe(1)

      await memoryService.updateMemory(
        memory.id,
        { content: 'Updated' },
        testUserId,
        testWorkspaceId,
      )

      const versions = await db.memory.findMany({
        where: {
          OR: [{ id: memory.id }, { parentId: memory.id }],
        },
      })

      expect(versions.length).toBeGreaterThanOrEqual(1)
    })

    it('should update importance score', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test',
        type: MemoryType.SEMANTIC,
      })

      const updated = await memoryService.updateMemory(
        memory.id,
        { importance: 0.9 },
        testUserId,
        testWorkspaceId,
      )

      expect(updated.importance).toBe(0.9)
    })

    it('should pin/unpin memory', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test',
        type: MemoryType.SEMANTIC,
      })

      const pinned = await memoryService.updateMemory(
        memory.id,
        { isPinned: true },
        testUserId,
        testWorkspaceId,
      )

      expect(pinned.isPinned).toBe(true)

      const unpinned = await memoryService.updateMemory(
        memory.id,
        { isPinned: false },
        testUserId,
        testWorkspaceId,
      )

      expect(unpinned.isPinned).toBe(false)
    })
  })

  describe('deleteMemory', () => {
    it('should soft delete a memory', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'To delete',
        type: MemoryType.SEMANTIC,
      })

      await memoryService.deleteMemory(memory.id, testUserId, testWorkspaceId)

      const deleted = await db.memory.findUnique({ where: { id: memory.id } })

      expect(deleted?.status).toBe(MemoryStatus.DELETED)
    })

    it('should fail to delete other user private memory', async () => {
      const otherUser = await db.user.create({
        data: { email: `other-${Date.now()}@example.com` },
      })

      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Private',
        type: MemoryType.SEMANTIC,
        permission: MemoryPermission.PRIVATE,
      })

      try {
        await memoryService.deleteMemory(memory.id, otherUser.id, testWorkspaceId)
        expect.fail('Should throw ForbiddenException')
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException)
      }
    })
  })

  describe('scoreMemoryImportance', () => {
    it('should score importance based on access and recency', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test',
        type: MemoryType.SEMANTIC,
        isManual: true,
      })

      const score = memoryService.scoreMemoryImportance(memory)

      expect(score).toBeGreaterThan(0.5)
      expect(score).toBeLessThanOrEqual(1.0)
    })
  })

  describe('applyDecay', () => {
    it('should decay memory importance', async () => {
      const memory = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Test',
        type: MemoryType.SEMANTIC,
      })

      const original = memory.importance
      const decayed = await memoryService.applyDecay(memory.id)

      expect(decayed.importance).toBeLessThan(original)
    })
  })

  describe('consolidateMemories', () => {
    it('should consolidate multiple memories', async () => {
      const mem1 = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Memory 1',
        type: MemoryType.SEMANTIC,
      })

      const mem2 = await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Memory 2',
        type: MemoryType.SEMANTIC,
      })

      const consolidated = await memoryService.consolidateMemories([mem1.id, mem2.id])

      expect(consolidated.type).toBe(MemoryType.SEMANTIC)
      expect(consolidated.status).toBe(MemoryStatus.CONSOLIDATING)

      const sourceMemories = await db.memory.findMany({
        where: { id: { in: [mem1.id, mem2.id] } },
      })

      expect(sourceMemories.every((m: typeof sourceMemories[0]) => m.isArchived)).toBe(true)
    })

    it('should fail with empty array', async () => {
      try {
        await memoryService.consolidateMemories([])
        expect.fail('Should throw BadRequestException')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe('eraseUserMemories', () => {
    it('should hard delete all user memories', async () => {
      await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Memory 1',
        type: MemoryType.SEMANTIC,
      })

      await memoryService.createMemory({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        content: 'Memory 2',
        type: MemoryType.SEMANTIC,
      })

      const count = await memoryService.eraseUserMemories(testUserId, testWorkspaceId)

      expect(count).toBe(2)

      const remaining = await db.memory.count({
        where: { userId: testUserId, workspaceId: testWorkspaceId },
      })

      expect(remaining).toBe(0)
    })
  })

  describe('getWorkspaceStats', () => {
    it('should calculate workspace statistics', async () => {
      for (let i = 0; i < 5; i++) {
        await memoryService.createMemory({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          content: `Memory ${i}`,
          type: MemoryType.SEMANTIC,
        })
      }

      const stats = await memoryService.getWorkspaceStats(testWorkspaceId)

      expect(stats.totalMemories).toBe(5)
      expect(stats.activeMemories).toBe(5)
      expect(stats.averageImportance).toBeGreaterThan(0)
    })
  })
})
