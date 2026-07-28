import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { promptTemplateService } from '../services/promptTemplate.service'

const router: Router = Router({ mergeParams: true })

const createPromptSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
})

const updatePromptSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
})

router.post('/:workspaceId/prompts', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = createPromptSchema.parse(req.body)

    const template = await promptTemplateService.create(req.userId!, workspaceId, input)
    res.status(201).json(createApiResponse(template))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/prompts', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const { skip, take, category, isPublic, search } = req.query

    const result = await promptTemplateService.listByWorkspace(req.userId!, workspaceId, {
      skip: skip ? parseInt(skip as string) : undefined,
      take: take ? parseInt(take as string) : undefined,
      category: category as string | undefined,
      isPublic: isPublic === 'true' ? true : isPublic === 'false' ? false : undefined,
      search: search as string | undefined,
    })

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/prompts/:promptId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { promptId } = req.params

    const template = await promptTemplateService.getById(req.userId!, promptId)
    if (!template) {
      res.status(404).json(createApiResponse({ error: 'Prompt template not found' }))
      return
    }

    res.json(createApiResponse(template))
  } catch (error) {
    next(error)
  }
})

router.patch('/:workspaceId/prompts/:promptId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { promptId } = req.params
    const input = updatePromptSchema.parse(req.body)

    const template = await promptTemplateService.update(req.userId!, promptId, input)
    res.json(createApiResponse(template))
  } catch (error) {
    next(error)
  }
})

router.delete('/:workspaceId/prompts/:promptId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { promptId } = req.params

    await promptTemplateService.delete(req.userId!, promptId)
    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/prompts/:promptId/use', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { promptId } = req.params

    const template = await promptTemplateService.incrementUsage(promptId)
    res.json(createApiResponse({ usageCount: template.usageCount }))
  } catch (error) {
    next(error)
  }
})

export default router
