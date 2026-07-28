import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { sharingService } from '../services/sharing.service'

const router: Router = Router({ mergeParams: true })

const createShareSchema = z.object({
  permissions: z.enum(['VIEW', 'COMMENT', 'EDIT']).optional(),
  isPublic: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
})

const addCollaboratorSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['VIEWER', 'EDITOR', 'OWNER']).optional(),
})

router.post('/:workspaceId/conversations/:conversationId/share', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const input = createShareSchema.parse(req.body)

    const share = await sharingService.createShareLink(req.userId!, conversationId, {
      permissions: input.permissions,
      isPublic: input.isPublic,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    })
    res.status(201).json(createApiResponse(share))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/share', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const shares = await sharingService.listShareLinks(req.userId!, conversationId)
    res.json(createApiResponse(shares))
  } catch (error) {
    next(error)
  }
})

router.delete(
  '/:workspaceId/conversations/:conversationId/share/:shareId',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId, shareId } = req.params

      await sharingService.revokeShareLink(req.userId!, conversationId, shareId)
      res.json(createApiResponse({ success: true }))
    } catch (error) {
      next(error)
    }
  }
)


router.post(
  '/:workspaceId/conversations/:conversationId/collaborators',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId } = req.params
      const input = addCollaboratorSchema.parse(req.body)

      const collaborator = await sharingService.addCollaborator(req.userId!, conversationId, input)
      res.status(201).json(createApiResponse(collaborator))
    } catch (error) {
      next(error)
    }
  }
)

router.get(
  '/:workspaceId/conversations/:conversationId/collaborators',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId } = req.params

      const collaborators = await sharingService.listCollaborators(req.userId!, conversationId)
      res.json(createApiResponse(collaborators))
    } catch (error) {
      next(error)
    }
  }
)

router.delete(
  '/:workspaceId/conversations/:conversationId/collaborators/:collaboratorUserId',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId, collaboratorUserId } = req.params

      await sharingService.removeCollaborator(req.userId!, conversationId, collaboratorUserId)
      res.json(createApiResponse({ success: true }))
    } catch (error) {
      next(error)
    }
  }
)

router.get(
  '/:workspaceId/conversations/:conversationId/activity',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId } = req.params
      const { take } = req.query

      const activity = await sharingService.listActivity(
        req.userId!,
        conversationId,
        take ? parseInt(take as string) : undefined
      )
      res.json(createApiResponse(activity))
    } catch (error) {
      next(error)
    }
  }
)

export default router
