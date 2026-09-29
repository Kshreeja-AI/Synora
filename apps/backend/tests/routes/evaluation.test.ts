import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'

describe('Evaluation Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let datasetId: string
  let modelId: string
  let otherModelId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-evaluation-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-evaluation-${Date.now()}`,
      },
    })
    workspaceId = workspace.id

    await prisma.workspaceMember.create({
      data: { userId, workspaceId, role: 'OWNER' },
    })

    const dataset = await prisma.dataset.create({
      data: {
        workspaceId,
        name: 'Test Dataset',
        datasetType: 'SFT',
        createdBy: userId,
      },
    })
    datasetId = dataset.id

    const model = await prisma.modelRegistry.create({
      data: { workspaceId, providerId: 'anthropic', modelName: 'Model A' },
    })
    modelId = model.id

    const otherModel = await prisma.modelRegistry.create({
      data: { workspaceId, providerId: 'openai', modelName: 'Model B' },
    })
    otherModelId = otherModel.id

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.evaluationResult.deleteMany({ where: { evaluationRun: { workspaceId } } })
    await prisma.evaluationRun.deleteMany({ where: { workspaceId } })
    await prisma.modelVersion.deleteMany({ where: { model: { workspaceId } } })
    await prisma.modelRegistry.deleteMany({ where: { workspaceId } })
    await prisma.dataset.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  async function createRun(overrides: { metrics?: string[] } = {}) {
    return request(app)
      .post(`/api/workspaces/${workspaceId}/evaluations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        datasetId,
        modelId,
        metrics: overrides.metrics ?? ['accuracy', 'f1_score', 'latency'],
      })
  }

  describe('POST /api/workspaces/:workspaceId/evaluations', () => {
    it('should create an evaluation run', async () => {
      const response = await createRun()

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.runId).toBeDefined()
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/evaluations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          datasetId,
          // Missing modelId and metrics
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should require at least one metric', async () => {
      const response = await createRun({ metrics: [] })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/evaluations', () => {
    it('should list evaluation runs with pagination', async () => {
      await createRun()

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/evaluations?skip=0&take=20`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.runs)).toBe(true)
    })

    it('should support pagination parameters', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/evaluations?skip=10&take=50`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.runs).toBeDefined()
    })
  })

  describe('GET /api/workspaces/:workspaceId/evaluations/:runId', () => {
    it('should get evaluation results by run ID', async () => {
      const createRes = await createRun()
      const runId = createRes.body.data.runId

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/evaluations/${runId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.run.id).toBe(runId)
    })

    it('should return 404 for non-existent evaluation', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/evaluations/non-existent-id`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/evaluations/:runId/run', () => {
    it('should trigger evaluation execution', async () => {
      const createRes = await createRun()
      const runId = createRes.body.data.runId

      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/evaluations/${runId}/run`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })
  })

  describe('POST /api/workspaces/:workspaceId/evaluations/compare', () => {
    it('should compare multiple models', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/evaluations/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          datasetId,
          modelIds: [modelId, otherModelId],
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toBeDefined()
    })

    it('should validate required fields for comparison', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/evaluations/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          datasetId,
          // Missing modelIds
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should reject unknown model ids', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/evaluations/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          datasetId,
          modelIds: ['non-existent-model'],
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should return comparison results keyed by model name', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/evaluations/compare`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          datasetId,
          modelIds: [modelId, otherModelId],
        })

      expect(response.status).toBe(200)
      expect(response.body.data.models).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('should handle authentication failures', async () => {
      const response = await request(app).get(`/api/workspaces/${workspaceId}/evaluations`)

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle invalid workspace ID', async () => {
      const response = await request(app)
        .get(`/api/workspaces/invalid-workspace/evaluations`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })
})
