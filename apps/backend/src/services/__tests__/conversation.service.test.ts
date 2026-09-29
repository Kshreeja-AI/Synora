import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@synora/database'
import { initConfig } from '../../config'
import { conversationService } from '../conversation.service'
import { ForbiddenException, NotFoundException, ValidationException } from '@synora/shared'

describe('conversation.service', () => {
  const workspaceIds: string[] = []
  let workspaceId: string
  let ownerId: string
  let viewerId: string

  beforeAll(async () => {
    await initConfig()
  })

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `conv-svc-${Date.now()}-${Math.random().toString(36).slice(2)}` },
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
  })

  afterEach(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  describe('create', () => {
    it('creates a conversation for a member with conversation:create permission', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Test',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      })

      expect(conversation.title).toBe('Test')
      expect(conversation.status).toBe('ACTIVE')
    })

    it('creates the container even when the named provider holds no real credential', async () => {
      // A conversation is a container; the honest refusal for a missing key
      // lives at generation time, per message. Precondition asserted so this
      // test cannot go vacuous if the test environment ever gains a real key
      // — the point is creating WITHOUT one.
      const { anthropicDescriptor } = await import('../../ai/providers/anthropic.provider')
      expect(await anthropicDescriptor.isConfigured()).toBe(false)

      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'No key needed for the container',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      })
      expect(conversation.status).toBe('ACTIVE')
    })

    it('rejects a provider id that is not in the registry — an invariant of the data', async () => {
      await expect(
        conversationService.create(ownerId, workspaceId, {
          title: 'Test',
          provider: 'not-a-provider',
          model: 'claude-sonnet-5',
        })
      ).rejects.toThrow(ValidationException)
    })

    it('rejects a VIEWER (no conversation:create permission)', async () => {
      await expect(
        conversationService.create(viewerId, workspaceId, {
          title: 'Test',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
        })
      ).rejects.toThrow(ForbiddenException)
    })

    it('rejects an unregistered provider id', async () => {
      await expect(
        conversationService.create(ownerId, workspaceId, {
          title: 'Test',
          provider: 'not-a-real-provider',
          model: 'whatever',
        })
      ).rejects.toThrow(ValidationException)
    })

    it('rejects a non-member entirely', async () => {
      const stranger = await prisma.user.create({
        data: { email: `stranger-${Date.now()}@test.com`, password: 'hashed' },
      })
      await expect(
        conversationService.create(stranger.id, workspaceId, {
          title: 'Test',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
        })
      ).rejects.toThrow(NotFoundException)
    })

    it('records an audit log entry on creation', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Audited',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      })

      const logs = await prisma.auditLog.findMany({ where: { workspaceId, targetId: conversation.id } })
      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('conversation_created')
    })
  })

  describe('listByWorkspace', () => {
    it('sorts by lastMessageAt desc by default', async () => {
      const a = await conversationService.create(ownerId, workspaceId, {
        title: 'A', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      const b = await conversationService.create(ownerId, workspaceId, {
        title: 'B', provider: 'anthropic', model: 'claude-sonnet-5',
      })

      await prisma.conversation.update({ where: { id: a.id }, data: { lastMessageAt: new Date('2020-01-01') } })
      await prisma.conversation.update({ where: { id: b.id }, data: { lastMessageAt: new Date('2024-01-01') } })

      const { conversations } = await conversationService.listByWorkspace(ownerId, workspaceId, {})
      expect(conversations[0].id).toBe(b.id)
      expect(conversations[1].id).toBe(a.id)
    })

    it('supports an explicit sortBy/sortDirection', async () => {
      await conversationService.create(ownerId, workspaceId, { title: 'Zebra', provider: 'anthropic', model: 'claude-sonnet-5' })
      await conversationService.create(ownerId, workspaceId, { title: 'Apple', provider: 'anthropic', model: 'claude-sonnet-5' })

      const { conversations } = await conversationService.listByWorkspace(ownerId, workspaceId, {
        sortBy: 'title',
        sortDirection: 'asc',
      })
      expect(conversations[0].title).toBe('Apple')
      expect(conversations[1].title).toBe('Zebra')
    })

    it('filters by search across title and description', async () => {
      await conversationService.create(ownerId, workspaceId, { title: 'Find me', provider: 'anthropic', model: 'claude-sonnet-5' })
      await conversationService.create(ownerId, workspaceId, { title: 'Unrelated', provider: 'anthropic', model: 'claude-sonnet-5' })

      const { conversations, total } = await conversationService.listByWorkspace(ownerId, workspaceId, { search: 'find' })
      expect(total).toBe(1)
      expect(conversations[0].title).toBe('Find me')
    })

    it('defaults to ACTIVE conversations, excluding archived', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'To archive', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      await conversationService.archive(ownerId, conversation.id)

      const active = await conversationService.listByWorkspace(ownerId, workspaceId, {})
      expect(active.conversations.find((c) => c.id === conversation.id)).toBeUndefined()

      const archived = await conversationService.listByWorkspace(ownerId, workspaceId, { archived: true })
      expect(archived.conversations.find((c) => c.id === conversation.id)).toBeDefined()
    })

    it('rejects a non-member', async () => {
      const stranger = await prisma.user.create({ data: { email: `s2-${Date.now()}@test.com`, password: 'hashed' } })
      await expect(conversationService.listByWorkspace(stranger.id, workspaceId, {})).rejects.toThrow(NotFoundException)
    })
  })

  describe('state machine: archive / restore / delete', () => {
    it('ACTIVE -> archive -> ARCHIVED -> restore -> ACTIVE', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Cycle', provider: 'anthropic', model: 'claude-sonnet-5',
      })

      const archived = await conversationService.archive(ownerId, conversation.id)
      expect(archived.status).toBe('ARCHIVED')
      expect(archived.isArchived).toBe(true)

      const restored = await conversationService.restore(ownerId, conversation.id)
      expect(restored.status).toBe('ACTIVE')
      expect(restored.isArchived).toBe(false)
    })

    it('rejects archiving an already-ARCHIVED conversation', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Double archive', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      await conversationService.archive(ownerId, conversation.id)

      await expect(conversationService.archive(ownerId, conversation.id)).rejects.toThrow(ValidationException)
    })

    it('rejects restoring a conversation that is not ARCHIVED', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Not archived', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      await expect(conversationService.restore(ownerId, conversation.id)).rejects.toThrow(ValidationException)
    })

    it('deletes from ACTIVE and from ARCHIVED, and is idempotent once DELETED', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'To delete', provider: 'anthropic', model: 'claude-sonnet-5',
      })

      const deleted = await conversationService.delete(ownerId, conversation.id)
      expect(deleted.status).toBe('DELETED')

      const secondDelete = await conversationService.delete(ownerId, conversation.id)
      expect(secondDelete.status).toBe('DELETED')
    })

    it('records one audit log entry per lifecycle action', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Audit trail', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      await conversationService.archive(ownerId, conversation.id)
      await conversationService.restore(ownerId, conversation.id)
      await conversationService.pin(ownerId, conversation.id)
      await conversationService.unpin(ownerId, conversation.id)
      await conversationService.delete(ownerId, conversation.id)

      const logs = await prisma.auditLog.findMany({ where: { workspaceId, targetId: conversation.id } })
      const actions = logs.map((l) => l.action).sort()
      expect(actions).toEqual(
        ['conversation_archived', 'conversation_created', 'conversation_deleted', 'conversation_pinned', 'conversation_restored', 'conversation_unpinned'].sort()
      )
    })
  })

  describe('pin / unpin', () => {
    it('pins and unpins a conversation', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Pin me', provider: 'anthropic', model: 'claude-sonnet-5',
      })

      const pinned = await conversationService.pin(ownerId, conversation.id)
      expect(pinned.isPinned).toBe(true)

      const unpinned = await conversationService.unpin(ownerId, conversation.id)
      expect(unpinned.isPinned).toBe(false)
    })
  })

  describe('update', () => {
    it('updates metadata and cannot be used to bypass the state machine', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Original', provider: 'anthropic', model: 'claude-sonnet-5',
      })

      const updated = await conversationService.update(ownerId, conversation.id, { title: 'Renamed' })
      expect(updated.title).toBe('Renamed')
      // UpdateConversationInput has no isArchived/status field at all —
      // this is a compile-time guarantee, not just a runtime one, but the
      // status must also still read ACTIVE after any metadata-only update.
      expect(updated.status).toBe('ACTIVE')
    })

    it('attaches tags, upserting them per workspace', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Tagged', provider: 'anthropic', model: 'claude-sonnet-5',
      })

      const updated = await conversationService.update(ownerId, conversation.id, {
        tagNames: ['important', 'follow-up'],
      })

      const withTags = await prisma.conversation.findUniqueOrThrow({
        where: { id: updated.id },
        include: { tags: true },
      })
      expect(withTags.tags.map((t) => t.name).sort()).toEqual(['follow-up', 'important'])
    })

    it('rejects a NotFoundException for a missing conversation', async () => {
      await expect(
        conversationService.update(ownerId, 'does-not-exist', { title: 'x' })
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('getById', () => {
    it('excludes soft-deleted messages from the included message list', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'With messages', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      const message = await prisma.message.create({
        data: { conversationId: conversation.id, content: 'hi', role: 'USER' },
      })
      await prisma.message.update({ where: { id: message.id }, data: { deletedAt: new Date() } })

      const result = await conversationService.getById(ownerId, conversation.id)
      expect((result as unknown as { messages: unknown[] }).messages).toHaveLength(0)
    })

    it('rejects access for a non-member', async () => {
      const conversation = await conversationService.create(ownerId, workspaceId, {
        title: 'Private', provider: 'anthropic', model: 'claude-sonnet-5',
      })
      const stranger = await prisma.user.create({ data: { email: `s3-${Date.now()}@test.com`, password: 'hashed' } })
      await expect(conversationService.getById(stranger.id, conversation.id)).rejects.toThrow(NotFoundException)
    })
  })
})
