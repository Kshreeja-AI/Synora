import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { conversationService } from '../services/conversation.service'
import { conversationUsageService } from '../services/conversationUsage.service'
import { exportService } from '../services/export.service'
import { promoteConversationToProject } from '../services/projectWorkspace.service'

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
  tagNames: z.array(z.string().min(1).max(50)).max(20).optional(),
  // Nullable on purpose: null means "take it out of the project", which
  // is different from omitting the field ("leave it where it is").
  projectId: z.string().nullable().optional(),
})

const sortFieldSchema = z.enum(['createdAt', 'updatedAt', 'lastMessageAt', 'title'])
const sortDirectionSchema = z.enum(['asc', 'desc'])

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
    const { skip, take, search, archived, pinned, sortBy, sortDirection, folderId } = req.query

    const result = await conversationService.listByWorkspace(req.userId!, workspaceId, {
      skip: skip ? parseInt(skip as string) : undefined,
      take: take ? parseInt(take as string) : undefined,
      search: search as string | undefined,
      archived: archived === 'true',
      pinned: pinned === 'true' ? true : undefined,
      folderId: typeof folderId === 'string' && folderId.length > 0 ? folderId : undefined,
      sortBy: sortBy ? sortFieldSchema.parse(sortBy) : undefined,
      sortDirection: sortDirection ? sortDirectionSchema.parse(sortDirection) : undefined,
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

/**
 * Turn this conversation into a project.
 *
 * Work rarely starts as a project — it starts as a question, and somewhere
 * in the middle a person realises the thing is bigger than the thread.
 * This records that realisation in one action instead of six.
 */
router.post(
  '/:workspaceId/conversations/:conversationId/project',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { name } = z.object({ name: z.string().trim().max(200).optional() }).parse(req.body ?? {})
      const result = await promoteConversationToProject(
        req.userId!,
        req.params.workspaceId,
        req.params.conversationId,
        name,
      )
      res.status(201).json(createApiResponse(result))
    } catch (error) {
      next(error)
    }
  }
)

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

router.post('/:workspaceId/conversations/:conversationId/pin', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.pin(req.userId!, conversationId)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/unpin', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.unpin(req.userId!, conversationId)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/usage', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    // getById already enforces workspace membership and 404s a
    // cross-workspace id — reused here so this route can't be used to
    // probe for a conversation's existence without access to it.
    const conversation = await conversationService.getById(req.userId!, conversationId)
    if (!conversation) {
      res.status(404).json(createApiResponse({ error: 'Conversation not found' }))
      return
    }

    const usage = await conversationUsageService.getByConversationId(conversationId)
    res.json(
      createApiResponse(
        usage ?? { conversationId, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }
      )
    )
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/generate-title', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const conversation = await conversationService.generateTitle(req.userId!, conversationId)
    res.json(createApiResponse(conversation))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/export', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const { format } = req.query

    // Validate conversation access
    const conversation = await conversationService.getById(req.userId!, conversationId)
    if (!conversation) {
      res.status(404).json(createApiResponse({ error: 'Conversation not found' }))
      return
    }

    const exported = await exportService.export(req.userId!, conversationId, {
      format: (format as string) || 'markdown',
    })

    res.json(createApiResponse(exported))
  } catch (error) {
    next(error)
  }
})

export default router
