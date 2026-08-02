import { logger } from '../utils/logger'
import { prisma } from '@synora/database'
import { NotFoundException } from '@synora/shared'

export interface MessageFeedbackInput {
  messageId: string
  conversationId: string
  rating?: number
  isHelpful?: boolean
  thumbsUp?: boolean
  thumbsDown?: boolean
  feedbackType: 'RATING' | 'HELPFUL' | 'UNHELPFUL' | 'CORRECTION' | 'HALLUCINATION' | 'TOXICITY' | 'BIAS' | 'INCOMPLETE' | 'IRRELEVANT'
  comment?: string
  accuracyRating?: number
  clarityRating?: number
  completenessRating?: number
  relevanceRating?: number
}

export interface ConversationFeedbackInput {
  conversationId: string
  overallRating?: number
  isUseful?: boolean
  qualityScore?: number
  satisfactionScore?: number
  comment?: string
  relevanceRating?: number
  coherenceRating?: number
  usefulnessRating?: number
}

export interface CorrectionInput {
  messageId: string
  conversationId: string
  originalContent: string
  correctedContent: string
  correctionType: 'FACTUAL_ERROR' | 'GRAMMAR' | 'CLARITY' | 'TONE' | 'COMPLETENESS' | 'STYLE' | 'TECHNICAL' | 'OTHER'
  reason?: string
  confidence?: number
}

export interface HallucinationReportInput {
  messageId: string
  conversationId: string
  hallucinatedText: string
  factualCorrection: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category: 'FACTUAL_ERROR' | 'FALSE_CITATION' | 'INVENTED_INFORMATION' | 'OUTDATED_INFORMATION' | 'LOGICAL_ERROR'
  evidence?: string
  sourceUrl?: string
}

export interface PreferredResponseInput {
  conversationId: string
  preferredMessageId: string
  rejectedMessageId: string
  preferenceType: 'ACCURACY' | 'CLARITY' | 'HELPFULNESS' | 'RELEVANCE' | 'STYLE' | 'TONE' | 'COMPLETENESS' | 'SAFETY'
  reason?: string
  confidence?: number
}

class FeedbackService {
  async createMessageFeedback(userId: string, workspaceId: string, data: MessageFeedbackInput) {
    try {
      const message = await prisma.message.findUnique({
        where: { id: data.messageId },
        include: { conversation: true }
      })

      if (!message || message.conversation.workspaceId !== workspaceId) {
        throw new NotFoundException('Message not found')
      }

      const existingFeedback = await prisma.messageFeedback.findUnique({
        where: {
          messageId_userId: {
            messageId: data.messageId,
            userId
          }
        }
      })

      if (existingFeedback) {
        const feedback = await prisma.messageFeedback.update({
          where: { id: existingFeedback.id },
          data: {
            rating: data.rating,
            isHelpful: data.isHelpful,
            thumbsUp: data.thumbsUp,
            thumbsDown: data.thumbsDown,
            feedbackType: data.feedbackType,
            comment: data.comment,
            accuracyRating: data.accuracyRating,
            clarityRating: data.clarityRating,
            completenessRating: data.completenessRating,
            relevanceRating: data.relevanceRating
          }
        })

        logger.info('[feedback] Updated message feedback', {
          feedbackId: feedback.id,
          messageId: data.messageId,
          userId
        })

        return feedback
      }

      const feedback = await prisma.messageFeedback.create({
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          workspaceId,
          userId,
          rating: data.rating,
          isHelpful: data.isHelpful,
          thumbsUp: data.thumbsUp,
          thumbsDown: data.thumbsDown,
          feedbackType: data.feedbackType,
          comment: data.comment,
          accuracyRating: data.accuracyRating,
          clarityRating: data.clarityRating,
          completenessRating: data.completenessRating,
          relevanceRating: data.relevanceRating
        }
      })

      logger.info('[feedback] Created message feedback', {
        feedbackId: feedback.id,
        messageId: data.messageId,
        userId
      })

      return feedback
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      logger.error('[feedback] Failed to create message feedback', {
        error: error instanceof Error ? error.message : String(error),
        messageId: data.messageId,
        userId
      })
      throw new NotFoundException('Failed to create feedback')
    }
  }

  async createConversationFeedback(userId: string, workspaceId: string, data: ConversationFeedbackInput) {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: data.conversationId }
      })

      if (!conversation || conversation.workspaceId !== workspaceId) {
        throw new NotFoundException('Conversation not found')
      }

      const existingFeedback = await prisma.conversationFeedback.findUnique({
        where: {
          conversationId_userId: {
            conversationId: data.conversationId,
            userId
          }
        }
      })

      if (existingFeedback) {
        const feedback = await prisma.conversationFeedback.update({
          where: { id: existingFeedback.id },
          data: {
            overallRating: data.overallRating,
            isUseful: data.isUseful,
            qualityScore: data.qualityScore,
            satisfactionScore: data.satisfactionScore,
            comment: data.comment,
            relevanceRating: data.relevanceRating,
            coherenceRating: data.coherenceRating,
            usefulnessRating: data.usefulnessRating
          }
        })

        logger.info('[feedback] Updated conversation feedback', {
          feedbackId: feedback.id,
          conversationId: data.conversationId,
          userId
        })

        return feedback
      }

      const feedback = await prisma.conversationFeedback.create({
        data: {
          conversationId: data.conversationId,
          workspaceId,
          userId,
          overallRating: data.overallRating,
          isUseful: data.isUseful,
          qualityScore: data.qualityScore,
          satisfactionScore: data.satisfactionScore,
          comment: data.comment,
          relevanceRating: data.relevanceRating,
          coherenceRating: data.coherenceRating,
          usefulnessRating: data.usefulnessRating
        }
      })

      logger.info('[feedback] Created conversation feedback', {
        feedbackId: feedback.id,
        conversationId: data.conversationId,
        userId
      })

      return feedback
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      logger.error('[feedback] Failed to create conversation feedback', {
        error: error instanceof Error ? error.message : String(error),
        conversationId: data.conversationId,
        userId
      })
      throw new NotFoundException('Failed to create feedback')
    }
  }

  async createCorrection(userId: string, workspaceId: string, data: CorrectionInput) {
    try {
      const message = await prisma.message.findUnique({
        where: { id: data.messageId },
        include: { conversation: true }
      })

      if (!message || message.conversation.workspaceId !== workspaceId) {
        throw new NotFoundException('Message not found')
      }

      const correction = await prisma.correction.create({
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          workspaceId,
          userId,
          originalContent: data.originalContent,
          correctedContent: data.correctedContent,
          correctionType: data.correctionType,
          reason: data.reason,
          confidence: data.confidence
        }
      })

      logger.info('[feedback] Created correction', {
        correctionId: correction.id,
        messageId: data.messageId,
        userId
      })

      return correction
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      logger.error('[feedback] Failed to create correction', {
        error: error instanceof Error ? error.message : String(error),
        messageId: data.messageId,
        userId
      })
      throw new NotFoundException('Failed to create correction')
    }
  }

  async reportHallucination(userId: string, workspaceId: string, data: HallucinationReportInput) {
    try {
      const message = await prisma.message.findUnique({
        where: { id: data.messageId },
        include: { conversation: true }
      })

      if (!message || message.conversation.workspaceId !== workspaceId) {
        throw new NotFoundException('Message not found')
      }

      const report = await prisma.hallucinationReport.create({
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          workspaceId,
          userId,
          hallucinatedText: data.hallucinatedText,
          factualCorrection: data.factualCorrection,
          severity: data.severity,
          category: data.category,
          evidence: data.evidence,
          sourceUrl: data.sourceUrl
        }
      })

      logger.info('[feedback] Created hallucination report', {
        reportId: report.id,
        messageId: data.messageId,
        userId
      })

      return report
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      logger.error('[feedback] Failed to create hallucination report', {
        error: error instanceof Error ? error.message : String(error),
        messageId: data.messageId,
        userId
      })
      throw new NotFoundException('Failed to create hallucination report')
    }
  }

  async createPreferredResponse(userId: string, workspaceId: string, data: PreferredResponseInput) {
    try {
      const [preferredMessage, rejectedMessage] = await Promise.all([
        prisma.message.findUnique({
          where: { id: data.preferredMessageId },
          include: { conversation: true }
        }),
        prisma.message.findUnique({
          where: { id: data.rejectedMessageId },
          include: { conversation: true }
        })
      ])

      if (!preferredMessage || preferredMessage.conversation.workspaceId !== workspaceId) {
        throw new NotFoundException('Preferred message not found')
      }

      if (!rejectedMessage || rejectedMessage.conversation.workspaceId !== workspaceId) {
        throw new NotFoundException('Rejected message not found')
      }

      const preference = await prisma.preferredResponse.create({
        data: {
          conversationId: data.conversationId,
          workspaceId,
          userId,
          preferredMessageId: data.preferredMessageId,
          rejectedMessageId: data.rejectedMessageId,
          preferenceType: data.preferenceType,
          reason: data.reason,
          confidence: data.confidence
        }
      })

      logger.info('[feedback] Created preferred response', {
        preferenceId: preference.id,
        preferredMessageId: data.preferredMessageId,
        rejectedMessageId: data.rejectedMessageId,
        userId
      })

      return preference
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      logger.error('[feedback] Failed to create preferred response', {
        error: error instanceof Error ? error.message : String(error),
        preferredMessageId: data.preferredMessageId,
        userId
      })
      throw new NotFoundException('Failed to create preference')
    }
  }

  async listMessageFeedback(workspaceId: string, conversationId: string, skip: number = 0, take: number = 20) {
    try {
      const [feedback, total] = await Promise.all([
        prisma.messageFeedback.findMany({
          where: {
            conversationId,
            workspaceId
          },
          skip,
          take,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.messageFeedback.count({
          where: {
            conversationId,
            workspaceId
          }
        })
      ])

      return {
        items: feedback,
        total,
        skip,
        take,
        hasMore: skip + take < total
      }
    } catch (error) {
      logger.error('[feedback] Failed to list feedback', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        workspaceId
      })
      throw new NotFoundException('Failed to list feedback')
    }
  }

  async getFeedbackStats(workspaceId: string, conversationId?: string) {
    try {
      const where = { workspaceId, ...(conversationId && { conversationId }) }

      const [totalFeedback, helpfulCount, unhelpfulCount, averageRating] = await Promise.all([
        prisma.messageFeedback.count({ where }),
        prisma.messageFeedback.count({
          where: { ...where, isHelpful: true }
        }),
        prisma.messageFeedback.count({
          where: { ...where, isHelpful: false }
        }),
        prisma.messageFeedback.aggregate({
          where: { ...where, rating: { not: null } },
          _avg: { rating: true }
        })
      ])

      return {
        totalFeedback,
        helpfulCount,
        unhelpfulCount,
        averageRating: averageRating._avg.rating || 0
      }
    } catch (error) {
      logger.error('[feedback] Failed to get stats', {
        error: error instanceof Error ? error.message : String(error),
        workspaceId,
        conversationId
      })
      throw new NotFoundException('Failed to get feedback stats')
    }
  }
}

export const feedbackService = new FeedbackService()
