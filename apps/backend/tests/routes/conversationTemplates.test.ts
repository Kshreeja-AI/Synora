import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { initializeApp } from '../../src/index'
import { prisma } from '@synora/database'

describe('Conversation Templates Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-convtpl-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-convtpl-${Date.now()}`,
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

    const jwt = require('jsonwebtoken')
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.conversationTemplate.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/templates', () => {
    it('should create a conversation template', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/templates`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Code Review Session',
          description: 'Start a code review conversation',
          initialMessages: [
            { role: 'system', content: 'You are an expert code reviewer.' },
            { role: 'user', content: 'Please review the following code:' },
          ],
          category: 'coding',
        })

      expect(response.status).toBe(201)
      expect(response.body.data.name).toBe('Code Review Session')
      expect(response.body.data.category).toBe('coding')
      expect(response.body.data.initialMessages).toHaveLength(2)
      expect(response.body.data.usageCount).toBe(0)
    })

    it('should require at least one initial message', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/templates`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Empty',
          initialMessages: [],
        })

      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/templates', () => {
    beforeEach(async () => {
      await prisma.conversationTemplate.createMany({
        data: [
          {
            workspaceId,
            name: 'Template A',
            initialMessages: [{ role: 'system', content: 'A' }],
            category: 'coding',
          },
          {
            workspaceId,
            name: 'Template B',
            initialMessages: [{ role: 'system', content: 'B' }],
            category: 'writing',
          },
        ],
      })
    })

    it('should list conversation templates', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/templates`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.templates).toHaveLength(2)
      expect(response.body.data.total).toBe(2)
    })

    it('should filter by category', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/templates`)
        .query({ category: 'writing' })
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.templates).toHaveLength(1)
      expect(response.body.data.templates[0].name).toBe('Template B')
    })
  })

  describe('PATCH /api/workspaces/:workspaceId/templates/:templateId', () => {
    let templateId: string

    beforeEach(async () => {
      const tpl = await prisma.conversationTemplate.create({
        data: {
          workspaceId,
          name: 'Original',
          initialMessages: [{ role: 'system', content: 'Original' }],
        },
      })
      templateId = tpl.id
    })

    it('should update conversation template', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/templates/${templateId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated', category: 'analysis' })

      expect(response.status).toBe(200)
      expect(response.body.data.name).toBe('Updated')
      expect(response.body.data.category).toBe('analysis')
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/templates/:templateId', () => {
    let templateId: string

    beforeEach(async () => {
      const tpl = await prisma.conversationTemplate.create({
        data: {
          workspaceId,
          name: 'To Delete',
          initialMessages: [{ role: 'system', content: 'Delete me' }],
        },
      })
      templateId = tpl.id
    })

    it('should delete conversation template', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/templates/${templateId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)

      const found = await prisma.conversationTemplate.findUnique({ where: { id: templateId } })
      expect(found).toBeNull()
    })
  })

  describe('POST /api/workspaces/:workspaceId/templates/:templateId/use', () => {
    let templateId: string

    beforeEach(async () => {
      const tpl = await prisma.conversationTemplate.create({
        data: {
          workspaceId,
          name: 'Popular',
          initialMessages: [{ role: 'system', content: 'Popular' }],
          usageCount: 10,
        },
      })
      templateId = tpl.id
    })

    it('should increment usage count', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/templates/${templateId}/use`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.usageCount).toBe(11)
    })
  })
})
