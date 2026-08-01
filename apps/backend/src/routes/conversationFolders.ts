import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { conversationFolderService } from '../services/conversationFolder.service'

const router: Router = Router({ mergeParams: true })

const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().optional(),
})

const updateFolderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
})

router.post('/:workspaceId/conversation-folders', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = createFolderSchema.parse(req.body)

    const folder = await conversationFolderService.create(req.userId!, workspaceId, input)
    res.status(201).json(createApiResponse(folder))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversation-folders', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const parentId = typeof req.query.parentId === 'string' ? req.query.parentId : undefined

    const folders = await conversationFolderService.listByWorkspace(req.userId!, workspaceId, parentId)
    res.json(createApiResponse(folders))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversation-folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params

    const folder = await conversationFolderService.getById(req.userId!, folderId)
    if (!folder) {
      res.status(404).json(createApiResponse({ error: 'Folder not found' }))
      return
    }

    res.json(createApiResponse(folder))
  } catch (error) {
    next(error)
  }
})

router.patch('/:workspaceId/conversation-folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params
    const input = updateFolderSchema.parse(req.body)

    const folder = await conversationFolderService.update(req.userId!, folderId, input)
    res.json(createApiResponse(folder))
  } catch (error) {
    next(error)
  }
})

router.delete('/:workspaceId/conversation-folders/:folderId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.params

    await conversationFolderService.delete(req.userId!, folderId)
    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversation-folders/move', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId, folderId } = req.body

    if (!conversationId) {
      res.status(400).json(createApiResponse({ error: 'conversationId is required' }))
      return
    }

    await conversationFolderService.moveConversation(req.userId!, conversationId, folderId ?? null)
    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

export default router
