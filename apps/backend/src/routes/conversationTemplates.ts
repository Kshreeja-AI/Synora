import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { conversationTemplateService } from '../services/conversationTemplate.service'

const router: Router = Router({ mergeParams: true })

const createConvTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  initialUserMessage: z.string().optional(),
  suggestedFollowUps: z.array(z.string()).optional(),
  category: z.string().optional(),
  isPublic: z.boolean().optional(),
})

const updateConvTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().min(1).optional(),
  initialUserMessage: z.string().optional(),
  suggestedFollowUps: z.array(z.string()).optional(),
  category: z.string().optional(),
  isPublic: z.boolean().optional(),
})

router.post('/:workspaceId/templates', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = createConvTemplateSchema.parse(req.body)

    const template = await conversationTemplateService.create(req.userId!, workspaceId, input)
    res.status(201).json(createApiResponse(template))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/templates', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const { skip, take, category, search } = req.query

    const result = await conversationTemplateService.listByWorkspace(req.userId!, workspaceId, {
      skip: skip ? parseInt(skip as string) : undefined,
      take: take ? parseInt(take as string) : undefined,
      category: category as string | undefined,
      search: search as string | undefined,
    })

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/templates/:templateId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { templateId } = req.params

    const template = await conversationTemplateService.getById(req.userId!, templateId)
    if (!template) {
      res.status(404).json(createApiResponse({ error: 'Conversation template not found' }))
      return
    }

    res.json(createApiResponse(template))
  } catch (error) {
    next(error)
  }
})

router.patch('/:workspaceId/templates/:templateId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { templateId } = req.params
    const input = updateConvTemplateSchema.parse(req.body)

    const template = await conversationTemplateService.update(req.userId!, templateId, input)
    res.json(createApiResponse(template))
  } catch (error) {
    next(error)
  }
})

router.delete('/:workspaceId/templates/:templateId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { templateId } = req.params

    await conversationTemplateService.delete(req.userId!, templateId)
    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/templates/:templateId/use', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { templateId } = req.params

    const template = await conversationTemplateService.incrementUsage(templateId)
    res.json(createApiResponse({ usageCount: template.usageCount }))
  } catch (error) {
    next(error)
  }
})

export default router
