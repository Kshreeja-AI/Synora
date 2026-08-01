import { Router, type NextFunction } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth'
import { privacyConsentService } from '../services/privacyConsent.service'
import { createApiResponse } from '@synora/shared'
import { z } from 'zod'

const ConsentPolicySchema = z.object({
  collectFeedback: z.boolean().optional(),
  useForTraining: z.boolean().optional(),
  shareWithPartners: z.boolean().optional(),
  allowEvaluation: z.boolean().optional(),
})

const router: Router = Router({ mergeParams: true })

// Set user consent for workspace
router.post('/:workspaceId/privacy/consent', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params
    const consent = ConsentPolicySchema.parse(req.body)

    const result = await privacyConsentService.setUserConsent(req.userId!, workspaceId, consent)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get user consent
router.get('/:workspaceId/privacy/consent', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params

    const result = await privacyConsentService.getUserConsent(req.userId!, workspaceId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Revoke user consent
router.post('/:workspaceId/privacy/consent/revoke', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params

    await privacyConsentService.revokeUserConsent(req.userId!, workspaceId)

    res.json(createApiResponse({ success: true }))
  } catch (error) {
    next(error)
  }
})

// Set conversation training consent
router.post('/:workspaceId/conversations/:conversationId/training-consent', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, conversationId } = req.params
    const { allowUseInTraining, allowUseInEvaluation } = req.body

    const result = await privacyConsentService.setConversationTrainingConsent(
      req.userId!,
      conversationId,
      allowUseInTraining,
      allowUseInEvaluation
    )

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Get conversation training consent
router.get('/:workspaceId/conversations/:conversationId/training-consent', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { conversationId } = req.params

    const result = await privacyConsentService.getConversationTrainingConsent(conversationId, req.userId!)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

// Delete user data (GDPR)
router.post('/:workspaceId/privacy/delete-data', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params

    const result = await privacyConsentService.deleteUserData(req.userId!, workspaceId)

    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

export default router
