import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { toolSecretService } from '../services/toolSecret.service'

const router: Router = Router({ mergeParams: true })

// Validation schemas
const createSecretSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  secretType: z.string().min(1),
  plaintext: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
})

const updateSecretSchema = z.object({
  plaintext: z.string().min(1).optional(),
  description: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

/**
 * POST /api/workspaces/:workspaceId/tools/:toolId/secrets
 * Create a new encrypted secret for a tool
 */
router.post(
  '/:workspaceId/tools/:toolId/secrets',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, toolId } = req.params
      const input = createSecretSchema.parse(req.body)

      const secret = await toolSecretService.createSecret(req.userId!, {
        toolId,
        workspaceId,
        name: input.name,
        description: input.description,
        secretType: input.secretType,
        plaintext: input.plaintext,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      })

      res.status(201).json(createApiResponse(secret))
    } catch (error) {
      next(error)
    }
  }
)

/**
 * GET /api/workspaces/:workspaceId/tools/:toolId/secrets
 * List all secrets for a tool (metadata only, no plaintext)
 */
router.get('/:workspaceId/tools/:toolId/secrets', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, toolId } = req.params

    const secrets = await toolSecretService.listSecrets(req.userId!, toolId, workspaceId)
    res.json(createApiResponse(secrets))
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId
 * Get secret metadata (no plaintext)
 */
router.get(
  '/:workspaceId/tools/:toolId/secrets/:secretId',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, secretId } = req.params

      const secret = await toolSecretService.getSecretMetadata(req.userId!, secretId, workspaceId)
      res.json(createApiResponse(secret))
    } catch (error) {
      next(error)
    }
  }
)

/**
 * PATCH /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId
 * Update a secret (rotate plaintext or update metadata)
 */
router.patch(
  '/:workspaceId/tools/:toolId/secrets/:secretId',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, secretId } = req.params
      const input = updateSecretSchema.parse(req.body)

      const secret = await toolSecretService.updateSecret(req.userId!, secretId, workspaceId, {
        plaintext: input.plaintext,
        description: input.description,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      })

      res.json(createApiResponse(secret))
    } catch (error) {
      next(error)
    }
  }
)

/**
 * DELETE /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId
 * Delete a secret permanently
 */
router.delete(
  '/:workspaceId/tools/:toolId/secrets/:secretId',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, secretId } = req.params

      await toolSecretService.deleteSecret(req.userId!, secretId, workspaceId)
      res.json(createApiResponse({ success: true }))
    } catch (error) {
      next(error)
    }
  }
)

/**
 * POST /api/workspaces/:workspaceId/tools/:toolId/secrets/:secretId/rotate
 * Mark a secret for rotation
 */
router.post(
  '/:workspaceId/tools/:toolId/secrets/:secretId/rotate',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, secretId } = req.params

      const secret = await toolSecretService.markForRotation(req.userId!, secretId, workspaceId)
      res.json(createApiResponse(secret))
    } catch (error) {
      next(error)
    }
  }
)

export default router
