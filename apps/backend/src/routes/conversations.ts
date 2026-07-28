import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { conversationService } from '../services/conversation.service'

const router: Router = Router({ mergeParams: true })

const createConversationSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
})

const updateConversationSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  isArchived: z.boolean().optional(),
  isPinned: z.boolean().optional(),
})

router.post('/:workspaceId/conversations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = createConversationSchema.parse(req.body)

    const conversation = await conversationService.create(req.userId!, workspaceId, input)
    res.status(201).json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const { skip, take, search, archived, pinned } = req.query

    const result = await conversationService.listByWorkspace(req.userId!, workspaceId, {
      skip: skip ? parseInt(skip as string) : undefined,
      take: take ? parseInt(take as string) : undefined,
      search: search as string | undefined,
      archived: archived === 'true',
      pinned: pinned === 'true' ? true : undefined,
    })

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.getById(req.userId!, conversationId)

    if (!conversation) {
      res.status(404).json(createApiResponse({ error: 'Conversation not found' }))
      return
    }

    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.patch('/:workspaceId/conversations/:conversationId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const input = updateConversationSchema.parse(req.body)

    const conversation = await conversationService.update(req.userId!, conversationId, input)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.delete('/:workspaceId/conversations/:conversationId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.delete(req.userId!, conversationId)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/archive', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.archive(req.userId!, conversationId)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/restore', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.restore(req.userId!, conversationId)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

export default router
