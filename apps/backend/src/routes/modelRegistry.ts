import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth'
import { modelRegistryService } from '../services/modelRegistry.service'
import { createApiResponse } from '@synora/shared'
import { ModelVersionStatus } from '@prisma/client'
import { z } from 'zod'

const CreateModelSchema = z.object({
  modelName: z.string().min(1),
  description: z.string().optional(),
  providerId: z.string().min(1),
})

const CreateVersionSchema = z.object({
  versionNumber: z.string().min(1),
  status: z.nativeEnum(ModelVersionStatus),
  performanceMetrics: z.record(z.number()).optional(),
})

const PromoteVersionSchema = z.object({
  newStatus: z.nativeEnum(ModelVersionStatus),
})

const router: Router = Router({ mergeParams: true })

// Create model
router.post('/:workspaceId/models', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = CreateModelSchema.parse(req.body)

    const result = await modelRegistryService.createModel(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// List models
router.get('/:workspaceId/models', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const skip = req.query.skip ? parseInt(req.query.skip as string) : 0
    const take = req.query.take ? parseInt(req.query.take as string) : 20

    const result = await modelRegistryService.listModels(req.userId!, workspaceId, { skip, take })

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get model
router.get('/:workspaceId/models/:modelId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, modelId } = req.params

    const result = await modelRegistryService.getModel(req.userId!, workspaceId, modelId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Create model version
router.post('/:workspaceId/models/:modelId/versions', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, modelId } = req.params
    const input = CreateVersionSchema.parse(req.body)

    const result = await modelRegistryService.createVersion(req.userId!, workspaceId, {
      modelId,
      ...input,
    })

    res.status(201).json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Promote version
router.post('/:workspaceId/models/:modelId/versions/:versionId/promote', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, versionId } = req.params
    const { newStatus } = PromoteVersionSchema.parse(req.body)

    const result = await modelRegistryService.promoteVersion(req.userId!, workspaceId, versionId, newStatus)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get version history
router.get('/:workspaceId/models/:modelId/versions', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, modelId } = req.params

    const result = await modelRegistryService.getVersionHistory(req.userId!, workspaceId, modelId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get production version
router.get('/:workspaceId/models/:modelId/production', authMiddleware, async (req, res, next) => {
  try {
    const { workspaceId, modelId } = req.params

    const result = await modelRegistryService.getProductionVersion(workspaceId, modelId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Compare versions
router.post('/:workspaceId/models/compare', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const { versionIds } = req.body

    const result = await modelRegistryService.compareVersions(req.userId!, workspaceId, versionIds)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get metrics
router.get('/:workspaceId/models/:modelId/versions/:versionId/metrics', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, versionId } = req.params

    const result = await modelRegistryService.getMetrics(req.userId!, workspaceId, versionId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Deprecate model
router.post('/:workspaceId/models/:modelId/deprecate', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, modelId } = req.params

    await modelRegistryService.deprecateModel(req.userId!, workspaceId, modelId)

    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

export default router
