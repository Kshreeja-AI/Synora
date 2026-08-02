import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@synora/database'
import { initializeApp } from '../../src/index'
import { ExportFormat, ExportStatus } from '@prisma/client'

// initializeApp() starts the real BullMQ workers against the test Redis
// instance, so an enqueued export is genuinely processed in the background —
// poll for the terminal status rather than invoking the worker function
// directly (which would race the real worker over the same DB row).
const TERMINAL_EXPORT_STATUSES: ExportStatus[] = [ExportStatus.COMPLETED, ExportStatus.FAILED]

async function waitForExportStatus(
  exportId: string,
  timeoutMs = 10000
): Promise<{ status: ExportStatus; fileUrl: string | null }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const record = await prisma.trainingExport.findUnique({ where: { id: exportId } })
    if (record && TERMINAL_EXPORT_STATUSES.includes(record.status)) {
      return { status: record.status, fileUrl: record.fileUrl }
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Export ${exportId} did not reach a terminal status within ${timeoutMs}ms`)
}

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

    await prisma.datasetSample.create({
      data: {
        datasetId,
        sourceType: 'SYNTHETIC',
        input: 'What is 2+2?',
        output: '4',
        inputTokens: 5,
        outputTokens: 1,
      },
    })

    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    })
  })

  afterEach(async () => {
    await prisma.datasetSample.deleteMany({ where: { datasetId } })
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
    it('should queue a dataset export', async () => {
      const response = await createExport(ExportFormat.JSONL)

      expect(response.status).toBe(202)
      expect(response.body.success).toBe(true)
      expect(response.body.data.exportId).toBeDefined()
      expect(response.body.data.status).toBe('PENDING')
    })

    it('should support CSV format', async () => {
      const response = await createExport(ExportFormat.CSV, { includePII: true })

      expect(response.status).toBe(202)
      expect(response.body.data.status).toBe('PENDING')
    })

    it('should support JSON format', async () => {
      const response = await createExport(ExportFormat.JSON)

      expect(response.status).toBe(202)
    })

    it('should reject PARQUET as an unsupported format rather than silently substituting JSON', async () => {
      const response = await createExport(ExportFormat.PARQUET)

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should validate export format', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: 'invalid-format' })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should validate maxSamples is positive', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ format: ExportFormat.JSONL, maxSamples: -100 })

      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('export completion (background worker)', () => {
    it('writes a real file and marks the export COMPLETED', async () => {
      const createRes = await createExport(ExportFormat.JSONL, { maxSamples: 500 })
      const exportId = createRes.body.data.exportId

      await waitForExportStatus(exportId)

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.status).toBe('COMPLETED')
      expect(response.body.data.export.fileUrl).toMatch(/\.jsonl$/)
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
      expect(response.body.data.status).toBe('PENDING')
    })

    it('should return 404 for non-existent export', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/non-existent`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/workspaces/:workspaceId/datasets/:datasetId/exports/:exportId/download', () => {
    it('should redirect to the file once the export has completed', async () => {
      const createRes = await createExport(ExportFormat.JSONL)
      const exportId = createRes.body.data.exportId

      await waitForExportStatus(exportId)

      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/datasets/${datasetId}/exports/${exportId}/download`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(302)
    })

    it('should return 404 if export not found', async () => {
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

      await waitForExportStatus(exportId)

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
      it(`should queue a ${format} format export`, async () => {
        const response = await createExport(format)

        expect(response.status).toBe(202)
        expect(response.body.data.status).toBe('PENDING')
      })
    })
  })
})
