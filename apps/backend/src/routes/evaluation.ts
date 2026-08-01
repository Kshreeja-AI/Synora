import { Router, type NextFunction } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth'
import { evaluationService } from '../services/evaluation.service'
import { createApiResponse } from '@synora/shared'
import { EvaluationStatus } from '@prisma/client'
import { z } from 'zod'

const CreateEvaluationRunSchema = z.object({
  datasetId: z.string().min(1),
  modelId: z.string().min(1),
  metrics: z.array(z.string()).min(1),
})

const router: Router = Router({ mergeParams: true })

// Create evaluation run
router.post('/:workspaceId/evaluations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = CreateEvaluationRunSchema.parse(req.body)

    const result = await evaluationService.createEvaluationRun(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// List evaluation runs
router.get('/:workspaceId/evaluations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const skip = req.query.skip ? parseInt(req.query.skip as string) : 0
    const take = req.query.take ? parseInt(req.query.take as string) : 20
    const status = req.query.status as EvaluationStatus | undefined

    const result = await evaluationService.listEvaluationRuns(req.userId!, workspaceId, {
      skip,
      take,
    })

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get evaluation results
router.get('/:workspaceId/evaluations/:runId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, runId } = req.params

    const result = await evaluationService.getEvaluationResults(req.userId!, workspaceId, runId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Run evaluation (trigger execution)
router.post('/:workspaceId/evaluations/:runId/run', authMiddleware, async (req, res, next) => {
  try {
    const { workspaceId, runId } = req.params

    const result = await evaluationService.runEvaluation(runId, workspaceId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Compare models
router.post('/:workspaceId/evaluations/compare', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const { datasetId, modelIds } = req.body

    const result = await evaluationService.compareModels(req.userId!, workspaceId, datasetId, modelIds)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

export default router
