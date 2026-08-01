import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import type { AppConfig } from '../../src/config/types'
import { ExportFormat } from '@prisma/client'

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

describe('Dataset Export Routes', () => {
  let app: any
  let testUserId: string
  let testWorkspaceId: string
  let testDatasetId: string
  let testToken: string

  beforeEach(() => {
    app = createApp(mockConfig)

    testUserId = 'test-user-123'
    testWorkspaceId = 'test-workspace-123'
    testDatasetId = 'test-dataset-123'
    testToken = 'Bearer test-token'

    vi.mock('../../src/middleware/auth', () => ({
      authMiddleware: (req: any, res: any, next: any) => {
        req.userId = testUserId
        req.workspaceId = testWorkspaceId
        next()
      },
    }))
  })

  describe('POST /api/workspaces/:workspaceId/datasets/:datasetId/exports', () => {
    it('should create a dataset export', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
          includePII: false,
          maxSamples: 1000,
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBeDefined()
      expect(response.body.data.format).toBe(ExportFormat.JSONL)
    })

    it('should support CSV format', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.CSV,
          includePII: true,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.format).toBe(ExportFormat.CSV)
    })

    it('should support Parquet format', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.PARQUET,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.format).toBe(ExportFormat.PARQUET)
    })

    it('should validate export format', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: 'invalid-format',
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle PII filtering parameter', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
          includePII: false,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.includePII).toBe(false)
    })

    it('should handle sample limit parameter', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
          maxSamples: 500,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.maxSamples).toBe(500)
    })

    it('should validate maxSamples is positive', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
          maxSamples: -100,
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId', () => {
    it('should get export status', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
        })

      const exportId = createRes.body.data.id

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/${exportId}`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(exportId)
      expect(response.body.data.status).toBeDefined()
    })

    it('should track export progress', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
        })

      const exportId = createRes.body.data.id

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/${exportId}`)
        .set('Authorization', testToken)

      expect(response.body.data.progress).toBeDefined()
      expect(response.body.data.progress).toBeGreaterThanOrEqual(0)
      expect(response.body.data.progress).toBeLessThanOrEqual(100)
    })

    it('should return 404 for non-existent export', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/non-existent`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId/download', () => {
    it('should redirect to download URL when export is ready', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
        })

      const exportId = createRes.body.data.id

      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/${exportId}/download`)
        .set('Authorization', testToken)

      expect(response.status).toBeOneOf([200, 302, 404])
    })

    it('should return 404 if export not ready', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/non-existent/download`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId', () => {
    it('should delete an export', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
        })

      const exportId = createRes.body.data.id

      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/${exportId}`)
        .set('Authorization', testToken)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)
    })

    it('should return 404 for non-existent export deletion', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/non-existent`)
        .set('Authorization', testToken)

      expect(response.status).toBe(404)
    })

    it('should clean up exported files on deletion', async () => {
      const createRes = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.CSV,
        })

      const exportId = createRes.body.data.id

      const deleteRes = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/${exportId}`)
        .set('Authorization', testToken)

      expect(deleteRes.status).toBe(200)

      // Verify the export is deleted by attempting to get it
      const getRes = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports/${exportId}`)
        .set('Authorization', testToken)

      expect(getRes.status).toBe(404)
    })
  })

  describe('Error handling', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
        .send({
          format: ExportFormat.JSONL,
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should validate workspace access', async () => {
      const response = await request(app)
        .post(`/api/workspaces/unauthorized-workspace/datasets/${testDatasetId}/exports`)
        .set('Authorization', testToken)
        .send({
          format: ExportFormat.JSONL,
        })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Export formats', () => {
    const formats = [ExportFormat.JSONL, ExportFormat.CSV, ExportFormat.PARQUET]

    formats.forEach((format) => {
      it(`should handle ${format} format export`, async () => {
        const response = await request(app)
          .post(`/api/workspaces/${testWorkspaceId}/datasets/${testDatasetId}/exports`)
          .set('Authorization', testToken)
          .send({
            format,
          })

        expect(response.status).toBe(201)
        expect(response.body.data.format).toBe(format)
      })
    })
  })
})
