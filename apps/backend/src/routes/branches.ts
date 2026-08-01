import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { branchService } from '../services/branch.service'

const router: Router = Router({ mergeParams: true })

const createBranchSchema = z.object({
  parentId: z.string().min(1),
  content: z.string().optional(),
})

const setMainBranchSchema = z.object({
  messageId: z.string().min(1),
})

router.post('/:workspaceId/conversations/:conversationId/branches', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const input = createBranchSchema.parse(req.body)

    const message = await branchService.createBranch(req.userId!, conversationId, input)
    res.status(201).json(createApiResponse(message))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/branches', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const { parentId } = req.query

    if (!parentId || typeof parentId !== 'string') {
      res.status(400).json({ error: 'parentId query parameter is required' })
      return
    }

    const branches = await branchService.getBranches(req.userId!, conversationId, parentId)
    res.json(createApiResponse({ branches, total: branches.length }))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/tree', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const tree = await branchService.getMessageTree(req.userId!, conversationId)
    res.json(createApiResponse({ messages: tree }))
  } catch (error) {
    next(error)
  }
})

router.post('/:workspaceId/conversations/:conversationId/branches/set-main', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params
    const input = setMainBranchSchema.parse(req.body)

    const branch = await branchService.setMainBranch(req.userId!, conversationId, input.messageId)
    res.json(createApiResponse(branch))
  } catch (error) {
    next(error)
  }
})

router.delete('/:workspaceId/conversations/:conversationId/branches/:messageId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId, messageId } = req.params

    await branchService.deleteBranch(req.userId!, conversationId, messageId)
    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

export default router
