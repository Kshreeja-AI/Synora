import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth'
import { feedbackService } from '../services/feedback.service'
import { createApiResponse } from '@synora/shared'
import { z } from 'zod'

const MessageFeedbackSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  isHelpful: z.boolean().optional(),
  thumbsUp: z.boolean().optional(),
  thumbsDown: z.boolean().optional(),
  feedbackType: z.enum(['RATING', 'HELPFUL', 'UNHELPFUL', 'CORRECTION', 'HALLUCINATION', 'TOXICITY', 'BIAS', 'INCOMPLETE', 'IRRELEVANT']),
  comment: z.string().optional(),
  accuracyRating: z.number().int().min(1).max(5).optional(),
  clarityRating: z.number().int().min(1).max(5).optional(),
  completenessRating: z.number().int().min(1).max(5).optional(),
  relevanceRating: z.number().int().min(1).max(5).optional()
})

const ConversationFeedbackSchema = z.object({
  conversationId: z.string().min(1),
  overallRating: z.number().int().min(1).max(5).optional(),
  isUseful: z.boolean().optional(),
  qualityScore: z.number().int().min(1).max(100).optional(),
  satisfactionScore: z.number().int().min(1).max(100).optional(),
  comment: z.string().optional(),
  relevanceRating: z.number().int().min(1).max(5).optional(),
  coherenceRating: z.number().int().min(1).max(5).optional(),
  usefulnessRating: z.number().int().min(1).max(5).optional()
})

const CorrectionSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  originalContent: z.string().min(1),
  correctedContent: z.string().min(1),
  correctionType: z.enum(['FACTUAL_ERROR', 'GRAMMAR', 'CLARITY', 'TONE', 'COMPLETENESS', 'STYLE', 'TECHNICAL', 'OTHER']),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

const HallucinationReportSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  hallucinatedText: z.string().min(1),
  factualCorrection: z.string().min(1),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  category: z.enum(['FACTUAL_ERROR', 'FALSE_CITATION', 'INVENTED_INFORMATION', 'OUTDATED_INFORMATION', 'LOGICAL_ERROR']),
  evidence: z.string().optional(),
  sourceUrl: z.string().url().optional()
})

const PreferredResponseSchema = z.object({
  conversationId: z.string().min(1),
  preferredMessageId: z.string().min(1),
  rejectedMessageId: z.string().min(1),
  preferenceType: z.enum(['ACCURACY', 'CLARITY', 'HELPFULNESS', 'RELEVANCE', 'STYLE', 'TONE', 'COMPLETENESS', 'SAFETY']),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

const router: Router = Router({ mergeParams: true })

// Message feedback
router.post('/:workspaceId/feedback/messages', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = MessageFeedbackSchema.parse(req.body)

    const feedback = await feedbackService.createMessageFeedback(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(feedback))
  } catch (error) {
    next(error)
  }
})

router.get('/:workspaceId/conversations/:conversationId/feedback/messages', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, conversationId } = req.params
    const skip = req.query.skip ? parseInt(req.query.skip as string) : 0
    const take = req.query.take ? parseInt(req.query.take as string) : 20

    const result = await feedbackService.listMessageFeedback(workspaceId, conversationId, skip, take)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Reflection endpoint for the chat UI: returns only the requesting
// user's own feedback records for messages in this conversation, so a
// reloaded chat can show which messages they've already thumbed up or
// down without pulling in everyone else's ratings.
router.get(
  '/:workspaceId/conversations/:conversationId/feedback/messages/mine',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params
      const feedback = await feedbackService.listMyMessageFeedback(
        req.userId!,
        workspaceId,
        conversationId
      )
      res.json(createApiResponse({ items: feedback }))
    } catch (error) {
      next(error)
    }
  }
)

router.get('/:workspaceId/conversations/:conversationId/feedback/stats', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, conversationId } = req.params

    const stats = await feedbackService.getFeedbackStats(workspaceId, conversationId)

    res.json(createApiResponse(stats))
  } catch (error) {
    next(error)
  }
})

// Conversation feedback
router.post('/:workspaceId/feedback/conversations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = ConversationFeedbackSchema.parse(req.body)

    const feedback = await feedbackService.createConversationFeedback(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(feedback))
  } catch (error) {
    next(error)
  }
})

// Corrections
router.post('/:workspaceId/feedback/corrections', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = CorrectionSchema.parse(req.body)

    const correction = await feedbackService.createCorrection(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(correction))
  } catch (error) {
    next(error)
  }
})

// Hallucination reports
router.post('/:workspaceId/feedback/hallucinations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = HallucinationReportSchema.parse(req.body)

    const report = await feedbackService.reportHallucination(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(report))
  } catch (error) {
    next(error)
  }
})

// Preferred responses
router.post('/:workspaceId/feedback/preferences', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const input = PreferredResponseSchema.parse(req.body)

    const preference = await feedbackService.createPreferredResponse(req.userId!, workspaceId, input)

    res.status(201).json(createApiResponse(preference))
  } catch (error) {
    next(error)
  }
})

export default router
