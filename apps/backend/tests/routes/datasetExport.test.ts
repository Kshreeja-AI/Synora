import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'
import { ExportFormat } from '@prisma/client'

describe('Dataset Export Routes', () => {
  let app: any
  let workspaceId: string
  let userId: string
  let token: string
  let datasetId: string

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp()
    app = expressApp

    const user = await prisma.user.create({
      data: {
        email: `test-datasetexport-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })
    userId = user.id

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-ws-datasetexport-${Date.now()}`,
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

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.trainingExport.deleteMany({ where: { workspaceId } })
    await prisma.dataset.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  async function createExport(format: ExportFormat = ExportFormat.JSONL, extra: Record<string, unknown> = {}) {
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ format, ...extra })
    return response
  }

  describe('POST /api/workspaces/:workspaceId/datasets/:datasetId/exports', () => {
    it('should create a dataset export', async () => {
      const response = await createExport(ExportFormat.JSONL)

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.exportId).toBeDefined()
      expect(response.body.data.stats.format).toBe(ExportFormat.JSONL)
    })

    it('should support CSV format', async () => {
      const response = await createExport(ExportFormat.CSV, { includePII: true })

      expect(response.status).toBe(201)
      expect(response.body.data.stats.format).toBe(ExportFormat.CSV)
    })

    it('should support JSON format', async () => {
      const response = await createExport(ExportFormat.JSON)

      expect(response.status).toBe(201)
      expect(response.body.data.stats.format).toBe(ExportFormat.JSON)
    })

    it('should validate export format', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: 'invalid-format' })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle sample limit parameter', async () => {
      const response = await createExport(ExportFormat.JSONL, { maxSamples: 500 })

      expect(response.status).toBe(201)
      expect(response.body.data.stats.samplesExported).toBeLessThanOrEqual(500)
    })

    it('should validate maxSamples is positive', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: ExportFormat.JSONL, maxSamples: -100 })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('GET /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId', () => {
    it('should get export status', async () => {
      const createRes = await createExport(ExportFormat.JSONL)
      const exportId = createRes.body.data.exportId

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.export.id).toBe(exportId)
      expect(response.body.data.status).toBeDefined()
    })

    it('should return 404 for non-existent export', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/non-existent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId/download', () => {
    it('should redirect to download URL when export is ready', async () => {
      const createRes = await createExport(ExportFormat.JSONL)
      const exportId = createRes.body.data.exportId

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}/download`)
        .set('Authorization', `Bearer ${token}`)

      expect([200, 302, 404]).toContain(response.status)
    })

    it('should return 404 if export not ready', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/non-existent/download`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId', () => {
    it('should delete an export', async () => {
      const createRes = await createExport(ExportFormat.JSONL)
      const exportId = createRes.body.data.exportId

      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.success).toBe(true)
    })

    it('should return 404 for non-existent export deletion', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/non-existent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })

    it('should clean up exported files on deletion', async () => {
      const createRes = await createExport(ExportFormat.CSV)
      const exportId = createRes.body.data.exportId

      const deleteRes = await request(app)
        .delete(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(deleteRes.status).toBe(200)

      const getRes = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(getRes.status).toBe(404)
    })
  })

  describe('Error handling', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports`)
        .send({ format: ExportFormat.JSONL })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should validate workspace access', async () => {
      const response = await request(app)
        .post(`/api/workspaces/unauthorized-workspace/datasets/${datasetId}/exports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: ExportFormat.JSONL })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Export formats', () => {
    const formats = [ExportFormat.JSONL, ExportFormat.CSV, ExportFormat.JSON]

    formats.forEach((format) => {
      it(`should handle ${format} format export`, async () => {
        const response = await createExport(format)

        expect(response.status).toBe(201)
        expect(response.body.data.stats.format).toBe(format)
      })
    })
  })
})
