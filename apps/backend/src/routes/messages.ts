import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { messageService } from '../services/message.service'
import { MessageRole } from '@prisma/client'

const router: Router = Router({ mergeParams: true })

const createMessageSchema = z.object({
  content: z.string().min(1),
  role: z.nativeEnum(MessageRole),
  parentId: z.string().optional(),
})

const updateMessageSchema = z.object({
  content: z.string().min(1),
})

router.post('/:workspaceId/conversations/:conversationId/messages', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const input = createMessageSchema.parse(req.body)

    const message = await messageService.create(req.userId!, conversationId, input)
    res.status(201).json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/messages', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const { skip, take } = req.query

    const messages = await messageService.getConversationHistory(req.userId!, conversationId, {
      skip: skip ? parseInt(skip as string) : undefined,
      take: take ? parseInt(take as string) : undefined,
    })

    res.json(createApiResponse(messages))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/messages/:messageId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params

    const message = await messageService.getById(req.userId!, messageId)

    if (!message) {
      res.status(404).json(createApiResponse({ error: 'Message not found' }))
      return
    }

    res.json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

router.patch('/:workspaceId/conversations/:conversationId/messages/:messageId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params
    const input = updateMessageSchema.parse(req.body)

    const message = await messageService.update(req.userId!, messageId, input)
    res.json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

router.delete('/:workspaceId/conversations/:conversationId/messages/:messageId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params

    const message = await messageService.delete(req.userId!, messageId)
    res.json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/messages/:messageId/attachments', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params
    const schema = z.object({
      url: z.string().url(),
      mimeType: z.string().min(1),
      name: z.string().min(1),
      size: z.number().positive(),
    })
    const input = schema.parse(req.body)

    const attachment = await messageService.addAttachment(req.userId!, messageId, input)

    res.status(201).json(createApiResponse(attachment))
  } catch (error) {
    next(error)
  }
})

export default router
