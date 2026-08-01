import { prisma } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requireMembership } from './checks'

export interface ConsentPolicyInput {
  collectFeedback?: boolean
  useForTraining?: boolean
  shareWithPartners?: boolean
  allowEvaluation?: boolean
}

export class PrivacyConsentService {
  async setUserConsent(
    userId: string,
    workspaceId: string,
    consent: ConsentPolicyInput
  ): Promise<any> {
    // Verify user is in workspace
    await requireMembership(userId, workspaceId)

    // Check if user has already set consent for this workspace
    let privacyConsent = await prisma.privacyConsent.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    })

    if (privacyConsent) {
      // Update existing consent
      privacyConsent = await prisma.privacyConsent.update({
        where: { id: privacyConsent.id },
        data: {
          collectFeedback: consent.collectFeedback ?? privacyConsent.collectFeedback,
          useForTraining: consent.useForTraining ?? privacyConsent.useForTraining,
          shareWithPartners: consent.shareWithPartners ?? privacyConsent.shareWithPartners,
          allowEvaluation: consent.allowEvaluation ?? privacyConsent.allowEvaluation,
        },
      })
    } else {
      // Create new consent record
      privacyConsent = await prisma.privacyConsent.create({
        data: {
          userId,
          workspaceId,
          collectFeedback: consent.collectFeedback ?? false,
          useForTraining: consent.useForTraining ?? false,
          shareWithPartners: consent.shareWithPartners ?? false,
          allowEvaluation: consent.allowEvaluation ?? false,
          consentGivenAt: new Date(),
        },
      })
    }

    logger.info(`[privacy] User ${userId} consent updated`, {
      workspaceId,
      consentFields: Object.keys(consent),
    })

    return privacyConsent
  }

  async getUserConsent(userId: string, workspaceId: string): Promise<any | null> {
    return prisma.privacyConsent.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    })
  }

  async revokeUserConsent(userId: string, workspaceId: string): Promise<void> {
    const consent = await prisma.privacyConsent.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    })

    if (consent) {
      await prisma.privacyConsent.update({
        where: { id: consent.id },
        data: {
          collectFeedback: false,
          useForTraining: false,
          shareWithPartners: false,
          allowEvaluation: false,
          consentRevokedAt: new Date(),
        },
      })

      logger.info(`[privacy] User ${userId} revoked consent for workspace ${workspaceId}`)
    }
  }

  async canCollectFeedback(userId: string, workspaceId: string): Promise<boolean> {
    const consent = await this.getUserConsent(userId, workspaceId)
    return consent?.collectFeedback ?? false
  }

  async canUseForTraining(userId: string, workspaceId: string): Promise<boolean> {
    const consent = await this.getUserConsent(userId, workspaceId)
    return consent?.useForTraining ?? false
  }

  async setConversationTrainingConsent(
    userId: string,
    conversationId: string,
    allowUseInTraining: boolean,
    allowUseInEvaluation: boolean
  ): Promise<any> {
    // Get conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    // Verify user has access
    await requireMembership(userId, conversation.workspaceId)

    // Check if training consent already exists
    let trainingConsent = await prisma.trainingConsent.findFirst({
      where: {
        conversationId,
        userId,
      },
    })

    if (trainingConsent) {
      // Update existing consent
      trainingConsent = await prisma.trainingConsent.update({
        where: { id: trainingConsent.id },
        data: {
          allowUseInTraining,
          allowUseInEvaluation,
        },
      })
    } else {
      // Create new training consent record
      trainingConsent = await prisma.trainingConsent.create({
        data: {
          userId,
          conversationId,
          workspaceId: conversation.workspaceId,
          allowUseInTraining,
          allowUseInEvaluation,
        },
      })
    }

    logger.info(`[privacy] Conversation ${conversationId} training consent set`, {
      userId,
      allowUseInTraining,
      allowUseInEvaluation,
    })

    return trainingConsent
  }

  async getConversationTrainingConsent(conversationId: string, userId: string): Promise<any | null> {
    return prisma.trainingConsent.findFirst({
      where: {
        conversationId,
        userId,
      },
    })
  }

  async canUseConversationForTraining(conversationId: string, userId: string): Promise<boolean> {
    const consent = await this.getConversationTrainingConsent(conversationId, userId)
    return consent?.allowUseInTraining ?? false
  }

  async canUseConversationForEvaluation(conversationId: string, userId: string): Promise<boolean> {
    const consent = await this.getConversationTrainingConsent(conversationId, userId)
    return consent?.allowUseInEvaluation ?? false
  }

  async deleteUserData(userId: string, workspaceId: string): Promise<{ deletedCount: number }> {
    // Verify membership
    await requireMembership(userId, workspaceId)

    // Find all conversations in this workspace for which user provided feedback
    // Note: we delete all feedback/corrections the user provided across any conversation
    const feedbackByUser = await prisma.messageFeedback.findMany({
      where: {
        userId,
        workspaceId,
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    })

    const conversationIds = feedbackByUser.map((fb: any) => fb.conversationId)

    // Delete all feedback/corrections for user's conversations
    const feedbackDeleted = await prisma.messageFeedback.deleteMany({
      where: {
        conversationId: { in: conversationIds },
        userId,
      },
    })

    const correctionDeleted = await prisma.correction.deleteMany({
      where: {
        conversationId: { in: conversationIds },
        userId,
      },
    })

    // Delete preference data
    const preferenceDeleted = await prisma.preferredResponse.deleteMany({
      where: {
        conversationId: { in: conversationIds },
        userId,
      },
    })

    // Delete hallucination reports
    const hallucinationDeleted = await prisma.hallucinationReport.deleteMany({
      where: {
        conversationId: { in: conversationIds },
        userId,
      },
    })

    // Delete training consent records
    const trainingConsentDeleted = await prisma.trainingConsent.deleteMany({
      where: {
        conversationId: { in: conversationIds },
        userId,
      },
    })

    const totalDeleted =
      (feedbackDeleted?.count || 0) +
      (correctionDeleted?.count || 0) +
      (preferenceDeleted?.count || 0) +
      (hallucinationDeleted?.count || 0) +
      (trainingConsentDeleted?.count || 0)

    logger.info(`[privacy] User ${userId} data GDPR deleted from workspace ${workspaceId}`, {
      deletedRecords: totalDeleted,
    })

    return { deletedCount: totalDeleted }
  }
}

export const privacyConsentService = new PrivacyConsentService()
