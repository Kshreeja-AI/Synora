import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

/**
 * Conversation export/import routes. Pins the streaming export
 * contract (headers + content), the privacy property that deleted
 * messages never appear in an export, and that a JSON export can be
 * re-imported losslessly enough to reproduce the message sequence.
 */
describe('Conversation Export/Import Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let conversationId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-export-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-export-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: { userId, workspaceId, role: 'OWNER' },
    })

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Export Test Chat',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      },
    })
    conversationId = conversation.id

    await prisma.message.create({
      data: { conversationId, content: 'What is the plan?', role: 'USER' },
    })
    await prisma.message.create({
      data: { conversationId, content: 'Here is the plan.', role: 'ASSISTANT' },
    })
    await prisma.message.create({
      data: {
        conversationId,
        content: 'a deleted aside',
        role: 'USER',
        deletedAt: new Date(),
      },
    })

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.message.deleteMany({ where: { conversation: { workspaceId } } })
    await prisma.conversation.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('GET /export?format=markdown', () => {
    it('streams a markdown attachment with the conversation content', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=markdown`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/markdown')
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.text).toContain('# Export Test Chat')
      expect(response.text).toContain('What is the plan?')
      expect(response.text).toContain('Here is the plan.')
    })
  })

  describe('GET /export?format=json', () => {
    it('streams valid JSON with the conversation and messages', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=json`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('application/json')
      expect(response.headers['content-disposition']).toContain('attachment')

      const data = JSON.parse(response.text)
      expect(data.version).toBe('1.0')
      expect(data.conversation.title).toBe('Export Test Chat')
      expect(data.messages).toHaveLength(2)
    })

    it('never includes soft-deleted messages in any export format', async () => {
      const json = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=json`)
        .set('Authorization', `Bearer ${token}`)
      const markdown = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=markdown`)
        .set('Authorization', `Bearer ${token}`)

      expect(json.text).not.toContain('a deleted aside')
      expect(markdown.text).not.toContain('a deleted aside')
    })
  })

  describe('export validation', () => {
    it('rejects an unknown format', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=pdf`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(400)
    })

    it('returns 404 for a conversation outside the workspace path', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/nonexistent/export?format=json`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })

    it('requires authentication', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=json`)

      expect(response.status).toBe(401)
    })
  })

  describe('export → import roundtrip', () => {
    it('re-imports an exported JSON conversation with the same messages', async () => {
      const exported = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=json`)
        .set('Authorization', `Bearer ${token}`)

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: 'json', content: exported.text })

      expect(response.status).toBe(201)
      expect(response.body.data.conversationId).toBeDefined()
      expect(response.body.data.messageCount).toBe(2)

      const imported = await prisma.message.findMany({
        where: { conversationId: response.body.data.conversationId },
        orderBy: { createdAt: 'asc' },
      })
      expect(imported.map((m) => m.content)).toEqual([
        'What is the plan?',
        'Here is the plan.',
      ])
    })
  })
})
