import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { initializeApp } from '../../src/index'
import { prisma } from '@synora/database'

describe('Prompt Templates Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-prompt-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-prompt-${Date.now()}`,
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
    await prisma.promptTemplate.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  describe('POST /api/workspaces/:workspaceId/prompts', () => {
    it('should create a prompt template', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/prompts`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Code Review',
          content: 'You are an expert code reviewer. Review the following code for bugs, security issues, and best practices.',
          category: 'coding',
          tags: ['code', 'review'],
        })

      expect(response.status).toBe(201)
      expect(response.body.data.name).toBe('Code Review')
      expect(response.body.data.category).toBe('coding')
      expect(response.body.data.tags).toEqual(['code', 'review'])
      expect(response.body.data.usageCount).toBe(0)
    })
  })

  describe('GET /api/workspaces/:workspaceId/prompts', () => {
    beforeEach(async () => {
      await prisma.promptTemplate.createMany({
        data: [
          { workspaceId, name: 'Template 1', content: 'Content 1', category: 'coding', createdBy: userId },
          { workspaceId, name: 'Template 2', content: 'Content 2', category: 'writing', createdBy: userId },
        ],
      })
    })

    it('should list prompt templates', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/prompts`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.templates).toHaveLength(2)
      expect(response.body.data.total).toBe(2)
    })

    it('should filter by category', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/prompts`)
        .query({ category: 'coding' })
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.templates).toHaveLength(1)
      expect(response.body.data.templates[0].category).toBe('coding')
    })

    it('should search by name', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/prompts`)
        .query({ search: 'Template 1' })
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.templates).toHaveLength(1)
    })
  })

  describe('GET /api/workspaces/:workspaceId/prompts/:promptId', () => {
    let promptId: string

    beforeEach(async () => {
      const prompt = await prisma.promptTemplate.create({
        data: { workspaceId, name: 'My Prompt', content: 'System prompt content', createdBy: userId },
      })
      promptId = prompt.id
    })

    it('should get prompt by id', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/prompts/${promptId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.name).toBe('My Prompt')
    })

    it('should return 404 for nonexistent prompt', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/prompts/nonexistent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('PATCH /api/workspaces/:workspaceId/prompts/:promptId', () => {
    let promptId: string

    beforeEach(async () => {
      const prompt = await prisma.promptTemplate.create({
        data: { workspaceId, name: 'Original', content: 'Original content', createdBy: userId },
      })
      promptId = prompt.id
    })

    it('should update prompt template', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/prompts/${promptId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated', isFavorite: true })

      expect(response.status).toBe(200)
      expect(response.body.data.name).toBe('Updated')
      expect(response.body.data.isFavorite).toBe(true)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/prompts/:promptId', () => {
    let promptId: string

    beforeEach(async () => {
      const prompt = await prisma.promptTemplate.create({
        data: { workspaceId, name: 'To Delete', content: 'Will be deleted', createdBy: userId },
      })
      promptId = prompt.id
    })

    it('should delete prompt template', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/prompts/${promptId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)

      const found = await prisma.promptTemplate.findUnique({ where: { id: promptId } })
      expect(found).toBeNull()
    })
  })

  describe('POST /api/workspaces/:workspaceId/prompts/:promptId/use', () => {
    let promptId: string

    beforeEach(async () => {
      const prompt = await prisma.promptTemplate.create({
        data: { workspaceId, name: 'Popular', content: 'Popular content', usageCount: 5, createdBy: userId },
      })
      promptId = prompt.id
    })

    it('should increment usage count', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/prompts/${promptId}/use`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.usageCount).toBe(6)
    })
  })
})
