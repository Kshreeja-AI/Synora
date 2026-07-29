import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma, ConversationStatus, MessageRole } from '@synora/database'

/**
 * Release 3 Milestone 1: verifies the Conversation/Message data model
 * itself — defaults, relations, and cascade behavior — with no service
 * layer involved (that begins at M2/M3). A schema that behaves correctly
 * here is the thing every later milestone's business logic is built on;
 * this is the smoke test for that foundation, mirroring how
 * `client.test.ts` verifies the shared Prisma client directly.
 */
describe('Conversation/Message schema (Release 3 M1)', () => {
  const workspaceIds: string[] = []
  let workspaceId: string

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'M1 Schema Test Workspace', slug: `m1-schema-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceId = workspace.id
    workspaceIds.push(workspaceId)
  })

  afterEach(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
    workspaceIds.length = 0
  })

  it('creates a conversation with the documented defaults', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Untitled conversation',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      },
    })

    expect(conversation.status).toBe(ConversationStatus.ACTIVE)
    expect(conversation.isArchived).toBe(false)
    expect(conversation.isPinned).toBe(false)
    expect(conversation.description).toBeNull()
    expect(conversation.folderId).toBeNull()
  })

  it('stores provider/model as free-form strings, not a hardcoded provider', async () => {
    // Two conversations naming different, unrelated provider ids: the schema
    // does not constrain this to a known enum, matching the ai/registry.ts
    // descriptor pattern where a new provider is just a new string id.
    const anthropic = await prisma.conversation.create({
      data: { workspaceId, title: 'A', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    const somethingNew = await prisma.conversation.create({
      data: { workspaceId, title: 'B', provider: 'a-provider-that-does-not-exist-yet', model: 'whatever-model' },
    })

    expect(anthropic.provider).toBe('anthropic')
    expect(somethingNew.provider).toBe('a-provider-that-does-not-exist-yet')
  })

  it('builds a message thread via self-referential parentId', async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Thread test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })

    const root = await prisma.message.create({
      data: { conversationId: conversation.id, content: 'Hello', role: MessageRole.USER },
    })
    expect(root.parentId).toBeNull()

    const reply = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        content: 'Hi there',
        role: MessageRole.ASSISTANT,
        parentId: root.id,
      },
    })

    const rootWithChildren = await prisma.message.findUniqueOrThrow({
      where: { id: root.id },
      include: { children: true },
    })
    expect(rootWithChildren.children).toHaveLength(1)
    expect(rootWithChildren.children[0].id).toBe(reply.id)

    const replyWithParent = await prisma.message.findUniqueOrThrow({
      where: { id: reply.id },
      include: { parent: true },
    })
    expect(replyWithParent.parent?.id).toBe(root.id)
  })

  it('supports a SYSTEM-role message alongside USER/ASSISTANT', async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'System prompt test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })

    const system = await prisma.message.create({
      data: { conversationId: conversation.id, content: 'You are a helpful assistant.', role: MessageRole.SYSTEM },
    })

    expect(system.role).toBe(MessageRole.SYSTEM)
  })

  it('cascades: deleting a conversation deletes its messages', async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Cascade test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, content: 'Will be cascaded', role: MessageRole.USER },
    })

    await prisma.conversation.delete({ where: { id: conversation.id } })

    const found = await prisma.message.findUnique({ where: { id: message.id } })
    expect(found).toBeNull()
  })

  it('cascades: deleting a parent message deletes its children', async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Child cascade test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    const root = await prisma.message.create({
      data: { conversationId: conversation.id, content: 'Root', role: MessageRole.USER },
    })
    const child = await prisma.message.create({
      data: { conversationId: conversation.id, content: 'Child', role: MessageRole.ASSISTANT, parentId: root.id },
    })

    await prisma.message.delete({ where: { id: root.id } })

    const found = await prisma.message.findUnique({ where: { id: child.id } })
    expect(found).toBeNull()
  })

  it('cascades: deleting the workspace deletes its conversations', async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'Workspace cascade test', provider: 'anthropic', model: 'claude-sonnet-5' },
    })

    await prisma.workspace.delete({ where: { id: workspaceId } })
    workspaceIds.splice(workspaceIds.indexOf(workspaceId), 1)

    const found = await prisma.conversation.findUnique({ where: { id: conversation.id } })
    expect(found).toBeNull()
  })

  it('scopes conversations to their workspace — one workspace cannot see another’s', async () => {
    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'Other Workspace', slug: `m1-schema-other-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    })
    workspaceIds.push(otherWorkspace.id)

    await prisma.conversation.create({
      data: { workspaceId, title: 'Mine', provider: 'anthropic', model: 'claude-sonnet-5' },
    })
    await prisma.conversation.create({
      data: { workspaceId: otherWorkspace.id, title: 'Theirs', provider: 'anthropic', model: 'claude-sonnet-5' },
    })

    const mine = await prisma.conversation.findMany({ where: { workspaceId } })
    expect(mine).toHaveLength(1)
    expect(mine[0].title).toBe('Mine')
  })
})
