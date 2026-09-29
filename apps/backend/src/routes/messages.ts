import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { aiGenerationLimiter } from '../middleware/resourceRateLimit'
import { createApiResponse } from '@synora/shared'
import { messageService } from '../services/message.service'
import { MessageRole } from '@prisma/client'

const router: Router = Router({ mergeParams: true })

// ASSISTANT is deliberately not a client-creatable role here: an assistant
// message only ever comes from the background generation worker succeeding
// (see M2_IMPLEMENTATION_PLAN.md §9) — allowing a client to POST one
// directly would let it fabricate a "reply" that bypassed generation,
// retry tracking, and token accounting entirely.
const createMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum([MessageRole.USER, MessageRole.SYSTEM]),
  parentId: z.string().optional(),
  fileIds: z.array(z.string()).optional(),
})

const updateMessageSchema = z.object({
  content: z.string().min(1),
})

router.post('/:workspaceId/conversations/:conversationId/messages', authMiddleware, aiGenerationLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const input = createMessageSchema.parse(req.body)

    const message = await messageService.create(req.userId!, conversationId, input)

    if (input.role !== MessageRole.USER) {
      res.status(201).json(createApiResponse(message))
      return
    }

    // For user messages, create a placeholder assistant message and enqueue generation
    // The client will subscribe to SSE for streaming
    const assistantMessage = await messageService.createPlaceholder(conversationId, MessageRole.ASSISTANT, message.id)

    // Enqueue generation job (async, non-blocking)
    await messageService.enqueueGeneration(conversationId, message, assistantMessage, req.userId!)

    res.status(201).json(createApiResponse({ userMessage: message, assistantMessage, jobId: assistantMessage.id }))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/messages', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const { skip, take } = req.query

    const skipNum = skip ? Math.max(0, parseInt(skip as string)) : undefined
    const takeNum = take ? Math.max(1, Math.min(100, parseInt(take as string))) : undefined

    const messages = await messageService.getConversationHistory(req.userId!, conversationId, {
      skip: skipNum,
      take: takeNum,
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

router.post('/:workspaceId/conversations/:conversationId/messages/:messageId/regenerate', authMiddleware, aiGenerationLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params
    const message = await messageService.regenerate(req.userId!, messageId)
    res.status(202).json(createApiResponse({ message, jobId: message.id }))
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

router.post('/:workspaceId/conversations/:conversationId/messages/:messageId/pin', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params

    const message = await messageService.pinMessage(req.userId!, messageId)
    res.json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/messages/:messageId/unpin', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { messageId } = req.params

    const message = await messageService.unpinMessage(req.userId!, messageId)
    res.json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

export default router
