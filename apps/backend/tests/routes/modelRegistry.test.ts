import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import type { AppConfig } from '../../src/config/types'
import { ModelVersionStatus } from '@prisma/client'

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

describe('Model Registry Routes', () => {
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

  describe('POST /api/workspaces/:workspaceId/models', () => {
    it('should create a model', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Claude 3 Opus',
          description: 'Anthropic Claude 3 Opus model',
          providerId: 'anthropic',
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBeDefined()
      expect(response.body.data.modelName).toBe('Claude 3 Opus')
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          description: 'Missing modelName and providerId',
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models', () => {
    it('should list models with pagination', async () => {
      // Create a model first
      await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Test Model',
          providerId: 'openai',
        })

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/models?skip=0&take=20`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.items)).toBe(true)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId', () => {
    it('should get a model by ID', async () => {
      // Create a model first
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Test Model',
          providerId: 'openai',
        })

      const modelId = createRes.body.data.id

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/models/${modelId}`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.modelName).toBe('Test Model')
    })

    it('should return 404 for non-existent model', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/models/non-existent-id`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/:modelId/versions', () => {
    it('should create a model version', async () => {
      // Create model first
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Test Model',
          providerId: 'anthropic',
        })

      const modelId = createRes.body.data.id

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models/${modelId}/versions`)
        .set('Authorization', testToken)
        .send({
          versionNumber: '1.0.0',
          status: ModelVersionStatus.DRAFT,
          performanceMetrics: {
            accuracy: 0.95,
            latency_ms: 150,
          },
        })

      expect(response.status).toBe(201)
      expect(response.body.data.versionNumber).toBe('1.0.0')
      expect(response.body.data.status).toBe(ModelVersionStatus.DRAFT)
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/:modelId/versions/:versionId/promote', () => {
    it('should promote a version to new status', async () => {
      // Setup: create model and version
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Test Model',
          providerId: 'anthropic',
        })

      const modelId = createRes.body.data.id

      const versionRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models/${modelId}/versions`)
        .set('Authorization', testToken)
        .send({
          versionNumber: '1.0.0',
          status: ModelVersionStatus.DRAFT,
        })

      const versionId = versionRes.body.data.id

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models/${modelId}/versions/${versionId}/promote`)
        .set('Authorization', testToken)
        .send({
          newStatus: ModelVersionStatus.RELEASED,
        })

      expect(response.status).toBe(200)
      expect(response.body.data.status).toBe(ModelVersionStatus.RELEASED)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId/versions', () => {
    it('should get version history', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Test Model',
          providerId: 'anthropic',
        })

      const modelId = createRes.body.data.id

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/models/${modelId}/versions`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId/production', () => {
    it('should get production version (public endpoint)', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/models/test-model-id/production`)

      // Note: This endpoint doesn't require auth
      expect(response.status).toBeOneOf([200, 404])
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/compare', () => {
    it('should compare multiple versions', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models/compare`)
        .set('Authorization', testToken)
        .send({
          versionIds: ['version-1', 'version-2'],
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })
  })

  describe('GET /api/workspaces/:workspaceId/models/:modelId/versions/:versionId/metrics', () => {
    it('should get metrics for a version', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/models/model-1/versions/version-1/metrics`)
        .set('Authorization', testToken)

      expect(response.status).toBeOneOf([200, 404])
    })
  })

  describe('POST /api/workspaces/:workspaceId/models/:modelId/deprecate', () => {
    it('should deprecate a model', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models`)
        .set('Authorization', testToken)
        .send({
          modelName: 'Model to Deprecate',
          providerId: 'openai',
        })

      const modelId = createRes.body.data.id

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/models/${modelId}/deprecate`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)
    })
  })
})
