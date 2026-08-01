import { Router, type NextFunction } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth'
import { datasetExportService } from '../services/datasetExport.service'
import { createApiResponse } from '@synora/shared'
import { ExportFormat } from '@prisma/client'
import { z } from 'zod'

const ExportDatasetSchema = z.object({
  format: z.nativeEnum(ExportFormat),
  includePII: z.boolean().optional(),
  maxSamples: z.number().int().positive().optional(),
})

const router: Router = Router({ mergeParams: true })

// Export dataset
router.post('/:workspaceId/datasets/:datasetId/exports', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, datasetId } = req.params
    const input = ExportDatasetSchema.parse(req.body)

    const result = await datasetExportService.exportDataset(req.userId!, workspaceId, {
      datasetId,
      ...input,
    })

    res.status(201).json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get export status
router.get('/:workspaceId/datasets/:datasetId/exports/:exportId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, exportId } = req.params

    const result = await datasetExportService.getExportStatus(req.userId!, workspaceId, exportId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Download export
router.get('/:workspaceId/datasets/:datasetId/exports/:exportId/download', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, exportId } = req.params

    const exportData = await datasetExportService.getExportStatus(req.userId!, workspaceId, exportId)

    if (!exportData.export.fileUrl) {
      return res.status(404).json(createApiResponse(null))
    }

    res.redirect(exportData.export.fileUrl)
  } catch (error) {
    next(error)
  }
})

// Delete export
router.delete('/:workspaceId/datasets/:datasetId/exports/:exportId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, exportId } = req.params

    await datasetExportService.deleteExport(req.userId!, workspaceId, exportId)

    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

export default router
