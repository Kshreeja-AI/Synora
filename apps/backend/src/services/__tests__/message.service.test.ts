import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { initConfig } from '../../config'
import { messageService } from '../message.service'
import { ForbiddenException, NotFoundException } from '@synora/shared'

describe('message.service', () => {
  const workspaceIds: string[] = []
  let workspaceId: string
  let conversationId: string
  let ownerId: string
  let viewerId: string

  beforeAll(async () => {
    await initConfig()
  })

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `msg-svc-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceId = workspace.id
    workspaceIds.push(workspaceId)

    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, password: 'hashed' },
    })
    ownerId = owner.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId: ownerId, role: 'OWNER' } })

    const viewer = await prisma.user.create({
      data: { email: `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`, password: 'hashed' },
    })
    viewerId = viewer.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId: viewerId, role: 'VIEWER' } })

    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Test conversation', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    conversationId = conversation.id
  })

  afterEach(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  describe('create', () => {
    it('creates a USER message for a member with message:send permission', async () => {
      const message = await messageService.create(ownerId, conversationId, { content: 'Hello', role: 'USER' })
      expect(message.content).toBe('Hello')
      expect(message.deletedAt).toBeNull()
    })

    it('rejects a VIEWER', async () => {
      await expect(
        messageService.create(viewerId, conversationId, { content: 'Hello', role: 'USER' })
      ).rejects.toThrow(ForbiddenException)
    })

    it('rejects an unknown conversation', async () => {
      await expect(
        messageService.create(ownerId, 'does-not-exist', { content: 'Hello', role: 'USER' })
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('getConversationHistory', () => {
    it('excludes soft-deleted messages', async () => {
      const kept = await messageService.create(ownerId, conversationId, { content: 'Keep', role: 'USER' })
      const removed = await messageService.create(ownerId, conversationId, { content: 'Remove', role: 'USER' })
      await messageService.delete(ownerId, removed.id)

      const history = await messageService.getConversationHistory(ownerId, conversationId)
      expect(history.map((m) => m.id)).toEqual([kept.id])
    })

    it('rejects a non-member', async () => {
      const stranger = await prisma.user.create({ data: { email: `s-${Date.now()}@test.com`, password: 'hashed' } })
      await expect(messageService.getConversationHistory(stranger.id, conversationId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('delete (soft delete)', () => {
    it('sets deletedAt without removing the row', async () => {
      const message = await messageService.create(ownerId, conversationId, { content: 'Bye', role: 'USER' })
      const deleted = await messageService.delete(ownerId, message.id)

      expect(deleted.deletedAt).not.toBeNull()

      const stillThere = await prisma.message.findUnique({ where: { id: message.id } })
      expect(stillThere).not.toBeNull()
    })

    it('is idempotent — deleting twice does not throw or change the timestamp', async () => {
      const message = await messageService.create(ownerId, conversationId, { content: 'Bye', role: 'USER' })
      const first = await messageService.delete(ownerId, message.id)
      const second = await messageService.delete(ownerId, message.id)

      expect(second.deletedAt?.getTime()).toBe(first.deletedAt?.getTime())
    })

    it('never cascades to children — a soft delete is an UPDATE, not a DELETE', async () => {
      const root = await messageService.create(ownerId, conversationId, { content: 'Root', role: 'USER' })
      const child = await messageService.create(ownerId, conversationId, {
        content: 'Child', role: 'ASSISTANT', parentId: root.id,
      })

      await messageService.delete(ownerId, root.id)

      const childAfter = await prisma.message.findUnique({ where: { id: child.id } })
      expect(childAfter).not.toBeNull()
      expect(childAfter?.deletedAt).toBeNull()
    })
  })
})
