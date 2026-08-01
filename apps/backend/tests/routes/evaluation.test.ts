import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import type { AppConfig } from '../../src/config/types'

const mockConfig: AppConfig = {
  stage: 'test',
  modes: [],
  server: {
    port: 3001,
    corsOrigins: ['http://localhost:3000'],
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
  },
  jwt: {
    secret: 'test-secret',
    expiresIn: '15m',
  },
  storage: {
    provider: 'local',
    publicBasePath: '/uploads',
    localDirectory: './uploads',
  },
}

describe('Evaluation Routes', () => {
  let app: any
  let testUserId: string
  let testWorkspaceId: string
  let testToken: string

  beforeEach(() => {
    app = createApp(mockConfig)

    testUserId = 'test-user-123'
    testWorkspaceId = 'test-workspace-123'
    testToken = 'Bearer test-token'

    vi.mock('../../src/middleware/auth', () => ({
      authMiddleware: (req: any, res: any, next: any) => {
        req.userId = testUserId
        req.workspaceId = testWorkspaceId
        next()
      },
    }))
  })

  describe('POST /api/workspaces/:workspaceId/evaluations', () => {
    it('should create an evaluation run', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelId: 'model-123',
          metrics: ['accuracy', 'f1_score', 'latency'],
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBeDefined()
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          // Missing modelId and metrics
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should require at least one metric', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelId: 'model-123',
          metrics: [],
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/evaluations', () => {
    it('should list evaluation runs with pagination', async () => {
      // Create an evaluation first
      await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelId: 'model-123',
          metrics: ['accuracy'],
        })

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/evaluations?skip=0&take=20`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.items)).toBe(true)
    })

    it('should support status filtering', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/evaluations?status=PENDING`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })

    it('should support pagination parameters', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/evaluations?skip=10&take=50`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.items).toBeDefined()
    })
  })

  describe('GET /api/workspaces/:workspaceId/evaluations/:runId', () => {
    it('should get evaluation results by run ID', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelId: 'model-123',
          metrics: ['accuracy', 'latency'],
        })

      const runId = createRes.body.data.id

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/evaluations/${runId}`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.id).toBe(runId)
    })

    it('should return 404 for non-existent evaluation', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/evaluations/non-existent-id`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/evaluations/:runId/run', () => {
    it('should trigger evaluation execution', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelId: 'model-123',
          metrics: ['accuracy'],
        })

      const runId = createRes.body.data.id

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations/${runId}/run`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })

    it('should handle missing run ID', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations/non-existent/run`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/evaluations/compare', () => {
    it('should compare multiple models', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations/compare`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelIds: ['model-1', 'model-2', 'model-3'],
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toBeDefined()
    })

    it('should validate required fields for comparison', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations/compare`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          // Missing modelIds
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should require at least 2 models for comparison', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations/compare`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelIds: ['model-1'],
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should return comparison results with metrics', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/evaluations/compare`)
        .set('Authorization', testToken)
        .send({
          datasetId: 'dataset-123',
          modelIds: ['model-1', 'model-2'],
        })

      expect(response.status).toBe(200)
      expect(response.body.data.models).toBeDefined()
      expect(Array.isArray(response.body.data.models)).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should handle authentication failures', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/evaluations`)

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle invalid workspace ID', async () => {
      const response = await request(app)
        .get(`/api/workspaces/invalid-workspace/evaluations`)
        .set('Authorization', testToken)

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })
})
