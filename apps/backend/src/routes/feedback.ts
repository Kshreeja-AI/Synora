import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { createApiResponse } from '@synora/shared'
import { feedbackService } from '../services/feedback.service'
import { MessageFeedbackType, HallucinationSeverity, HallucinationCategory, CorrectionType, RewardType } from '@prisma/client'

const router: Router = Router({ mergeParams: true })

// Validation schemas
const createMessageFeedbackSchema = z.object({
  messageId: z.string().cuid(),
  feedbackType: z.nativeEnum(MessageFeedbackType),
  rating: z.number().min(1).max(5).optional(),
  thumbsUp: z.boolean().optional(),
  thumbsDown: z.boolean().optional(),
  comment: z.string().max(2000).optional(),
  accuracyRating: z.number().min(1).max(5).optional(),
  clarityRating: z.number().min(1).max(5).optional(),
  completenessRating: z.number().min(1).max(5).optional(),
  relevanceRating: z.number().min(1).max(5).optional(),
});

const createConversationFeedbackSchema = z.object({
  conversationId: z.string().cuid(),
  overallRating: z.number().min(1).max(5).optional(),
  isUseful: z.boolean().optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  satisfactionScore: z.number().min(0).max(100).optional(),
  comment: z.string().max(2000).optional(),
  relevanceRating: z.number().min(1).max(5).optional(),
  coherenceRating: z.number().min(1).max(5).optional(),
  usefulnessRating: z.number().min(1).max(5).optional(),
});

const createCorrectionSchema = z.object({
  messageId: z.string().cuid(),
  originalContent: z.string().min(1),
  correctedContent: z.string().min(1),
  reason: z.string().optional(),
  correctionType: z.nativeEnum(CorrectionType),
  confidence: z.number().min(0).max(1).optional(),
});

const createPreferredResponseSchema = z.object({
  conversationId: z.string().cuid(),
  preferredMessageId: z.string().cuid(),
  rejectedMessageId: z.string().cuid(),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const createHallucinationReportSchema = z.object({
  messageId: z.string().cuid(),
  hallucinatedText: z.string().min(1),
  factualCorrection: z.string().min(1),
  severity: z.nativeEnum(HallucinationSeverity),
  category: z.nativeEnum(HallucinationCategory),
  evidence: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});

const createRewardSignalSchema = z.object({
  conversationId: z.string().cuid(),
  messageId: z.string().cuid(),
  reward: z.number(),
  rewardType: z.nativeEnum(RewardType),
  comment: z.string().optional(),
});

// Message Feedback Routes
router.post('/:workspaceId/conversations/:conversationId/messages/:messageId/feedback',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, messageId, conversationId } = req.params;

      const payload = createMessageFeedbackSchema.parse(req.body);

      const feedback = await feedbackService.createMessageFeedback({
        messageId,
        conversationId,
        workspaceId,
        userId: req.userId!,
        feedbackType: payload.feedbackType,
        rating: payload.rating,
        thumbsUp: payload.thumbsUp,
        thumbsDown: payload.thumbsDown,
        comment: payload.comment,
        accuracyRating: payload.accuracyRating,
        clarityRating: payload.clarityRating,
        completenessRating: payload.completenessRating,
        relevanceRating: payload.relevanceRating,
      });

      res.status(201).json(createApiResponse(feedback));
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:workspaceId/messages/:messageId/feedback',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { messageId } = req.params;

      const feedback = await feedbackService.getMessageFeedback(messageId);

      res.json(createApiResponse(feedback));
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:workspaceId/feedback/:feedbackId',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, feedbackId } = req.params;

      await feedbackService.deleteMessageFeedback(feedbackId, workspaceId);

      res.json(createApiResponse({ success: true }));
    } catch (error) {
      next(error);
    }
  }
);

// Conversation Feedback Routes
router.post('/:workspaceId/conversations/:conversationId/feedback',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      const payload = createConversationFeedbackSchema.parse(req.body);

      const feedback = await feedbackService.createConversationFeedback({
        conversationId,
        workspaceId,
        userId: req.userId!,
        overallRating: payload.overallRating,
        isUseful: payload.isUseful,
        qualityScore: payload.qualityScore,
        satisfactionScore: payload.satisfactionScore,
        comment: payload.comment,
        relevanceRating: payload.relevanceRating,
        coherenceRating: payload.coherenceRating,
        usefulnessRating: payload.usefulnessRating,
      });

      res.status(201).json(createApiResponse(feedback));
    } catch (error) {
      next(error);
    }
  }
);

// Correction Routes
router.post('/:workspaceId/conversations/:conversationId/corrections',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      const payload = createCorrectionSchema.parse(req.body);

      const correction = await feedbackService.createCorrection({
        conversationId,
        workspaceId,
        userId: req.userId!,
        messageId: payload.messageId,
        originalContent: payload.originalContent,
        correctedContent: payload.correctedContent,
        reason: payload.reason,
        correctionType: payload.correctionType,
        confidence: payload.confidence,
      });

      res.status(201).json(createApiResponse(correction));
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:workspaceId/messages/:messageId/corrections',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { messageId } = req.params;

      const corrections = await feedbackService.getCorrections(messageId);

      res.json(createApiResponse(corrections));
    } catch (error) {
      next(error);
    }
  }
);

// Preferred Response Routes (Pairwise Preferences)
router.post('/:workspaceId/conversations/:conversationId/preferences',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      const payload = createPreferredResponseSchema.parse(req.body);

      const preference = await feedbackService.createPreferredResponse({
        conversationId,
        workspaceId,
        userId: req.userId!,
        preferredMessageId: payload.preferredMessageId,
        rejectedMessageId: payload.rejectedMessageId,
        reason: payload.reason,
        confidence: payload.confidence,
      });

      res.status(201).json(createApiResponse(preference));
    } catch (error) {
      next(error);
    }
  }
);

// Hallucination Report Routes
router.post('/:workspaceId/conversations/:conversationId/hallucinations',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      const payload = createHallucinationReportSchema.parse(req.body);

      const report = await feedbackService.createHallucinationReport({
        conversationId,
        workspaceId,
        userId: req.userId!,
        messageId: payload.messageId,
        hallucinatedText: payload.hallucinatedText,
        factualCorrection: payload.factualCorrection,
        severity: payload.severity,
        category: payload.category,
        evidence: payload.evidence,
        sourceUrl: payload.sourceUrl,
      });

      res.status(201).json(createApiResponse(report));
    } catch (error) {
      next(error);
    }
  }
);

// Reward Signal Routes (RLHF)
router.post('/:workspaceId/conversations/:conversationId/rewards',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      const payload = createRewardSignalSchema.parse(req.body);

      const signal = await feedbackService.createRewardSignal({
        conversationId,
        workspaceId,
        userId: req.userId!,
        messageId: payload.messageId,
        reward: payload.reward,
        rewardType: payload.rewardType,
        comment: payload.comment,
      });

      res.status(201).json(createApiResponse(signal));
    } catch (error) {
      next(error);
    }
  }
);

// Analytics Routes
router.get('/:workspaceId/feedback/stats',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { workspaceId } = req.params;

      const stats = await feedbackService.getWorkspaceFeedbackStats(workspaceId);

      res.json(createApiResponse(stats));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
