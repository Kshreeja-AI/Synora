import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'
import { ModelVersionStatus } from '@prisma/client'

describe('Model Registry Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-modelregistry-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-modelregistry-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: { userId, workspaceId, role: 'OWNER' },
    })

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.modelVersion.deleteMany({ where: { model: { workspaceId } } })
    await prisma.modelRegistry.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  async function createModel(overrides: { modelName?: string; providerId?: string } = {}) {
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/models`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        modelName: overrides.modelName ?? 'Test Model',
        providerId: overrides.providerId ?? 'anthropic',
      })
    return response.body.data as { model: { id: string }; version: { id: string } }
  }

  describe('POST /api/workspaces/:workspaceId/models', () => {
    it('should create a model', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/models`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          modelName: 'Claude 3 Opus',
          description: 'Anthropic Claude 3 Opus model',
          providerId: 'anthropic',
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.model.id).toBeDefined()
      expect(response.body.data.model.modelName).toBe('Claude 3 Opus')
      expect(response.body.data.version.versionString).toBe('1.0.0')
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/models`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Missing modelName and providerId',
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models', () => {
    it('should list models with pagination', async () => {
      await createModel({ modelName: 'Test Model', providerId: 'openai' })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/models?skip=0&take=20`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.models)).toBe(true)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId', () => {
    it('should get a model by ID', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'openai' })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/models/${created.model.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.modelName).toBe('Test Model')
    })

    it('should return 404 for non-existent model', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/models/non-existent-id`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/:modelId/versions', () => {
    it('should create a model version', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'anthropic' })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/models/${created.model.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          versionNumber: '1.1.0',
          status: ModelVersionStatus.DRAFT,
          performanceMetrics: {
            accuracy: 0.95,
            latency_ms: 150,
          },
        })

      expect(response.status).toBe(201)
      expect(response.body.data.versionString).toBe('1.1.0')
      expect(response.body.data.status).toBe(ModelVersionStatus.DRAFT)
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/:modelId/versions/:versionId/promote', () => {
    it('should promote a version to new status', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'anthropic' })

      const promoteToTraining = await request(app)
        .post(
          `/api/workspaces/${workspaceId}/models/${created.model.id}/versions/${created.version.id}/promote`
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ newStatus: ModelVersionStatus.TRAINING })
      expect(promoteToTraining.status).toBe(200)

      const promoteToEvaluating = await request(app)
        .post(
          `/api/workspaces/${workspaceId}/models/${created.model.id}/versions/${created.version.id}/promote`
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ newStatus: ModelVersionStatus.EVALUATING })
      expect(promoteToEvaluating.status).toBe(200)

      const response = await request(app)
        .post(
          `/api/workspaces/${workspaceId}/models/${created.model.id}/versions/${created.version.id}/promote`
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ newStatus: ModelVersionStatus.RELEASED })

      expect(response.status).toBe(200)
      expect(response.body.data.status).toBe(ModelVersionStatus.RELEASED)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId/versions', () => {
    it('should get version history', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'anthropic' })

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/models/${created.model.id}/versions`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
      expect(response.body.data.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId/production', () => {
    it('should get production version (public endpoint)', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/models/test-model-id/production`)
        .set('Authorization', `Bearer ${token}`)

      expect([200, 404]).toContain(response.status)
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/compare', () => {
    it('should compare multiple versions', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'anthropic' })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/models/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          versionIds: [created.version.id],
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })

    it('should return comparison results with metrics', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'anthropic' })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/models/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          versionIds: [created.version.id],
        })

      expect(response.status).toBe(200)
      expect(response.body.data.versions).toBeDefined()
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId/versions/:versionId/metrics', () => {
    it('should get metrics for a version', async () => {
      const created = await createModel({ modelName: 'Test Model', providerId: 'anthropic' })

      const response = await request(app)
        .get(
          `/api/workspaces/${workspaceId}/models/${created.model.id}/versions/${created.version.id}/metrics`
        )
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.modelId).toBe(created.model.id)
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/:modelId/deprecate', () => {
    it('should deprecate a model', async () => {
      const created = await createModel({ modelName: 'Model to Deprecate', providerId: 'openai' })

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/models/${created.model.id}/deprecate`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)
    })
  })
})
