import { prisma } from '@synora/database'
import {
  MessageFeedback,
  ConversationFeedback,
  MessageFeedbackType,
  Correction,
  CorrectionType,
  PreferredResponse,
  HallucinationReport,
  HallucinationSeverity,
  HallucinationCategory,
  RewardSignal,
  RewardType,
} from '@prisma/client'

export interface CreateMessageFeedbackInput {
  messageId: string;
  conversationId: string;
  workspaceId: string;
  userId: string;
  rating?: number;
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  feedbackType: MessageFeedbackType;
  comment?: string;
  accuracyRating?: number;
  clarityRating?: number;
  completenessRating?: number;
  relevanceRating?: number;
}

export interface CreateConversationFeedbackInput {
  conversationId: string;
  workspaceId: string;
  userId: string;
  overallRating?: number;
  isUseful?: boolean;
  qualityScore?: number;
  satisfactionScore?: number;
  comment?: string;
  relevanceRating?: number;
  coherenceRating?: number;
  usefulnessRating?: number;
}

export interface CreateCorrectionInput {
  messageId: string;
  conversationId: string;
  workspaceId: string;
  userId: string;
  originalContent: string;
  correctedContent: string;
  reason?: string;
  correctionType: CorrectionType;
  confidence?: number;
}

export interface CreatePreferredResponseInput {
  conversationId: string;
  workspaceId: string;
  userId: string;
  preferredMessageId: string;
  rejectedMessageId: string;
  reason?: string;
  confidence?: number;
}

export interface CreateHallucinationReportInput {
  messageId: string;
  conversationId: string;
  workspaceId: string;
  userId: string;
  hallucinatedText: string;
  factualCorrection: string;
  severity: HallucinationSeverity;
  category: HallucinationCategory;
  evidence?: string;
  sourceUrl?: string;
}

export interface CreateRewardSignalInput {
  conversationId: string;
  messageId: string;
  workspaceId: string;
  userId: string;
  reward: number;
  rewardType: RewardType;
  comment?: string;
}

export class FeedbackService {

  // Message Feedback
  async createMessageFeedback(input: CreateMessageFeedbackInput): Promise<MessageFeedback> {
    // Validate that message exists and user has access
    const message = await prisma.message.findUnique({
      where: { id: input.messageId },
      include: { conversation: true },
    });

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.conversation.workspaceId !== input.workspaceId) {
      throw new Error('Unauthorized');
    }

    // Check if feedback already exists from this user
    const existing = await prisma.messageFeedback.findUnique({
      where: {
        messageId_userId: {
          messageId: input.messageId,
          userId: input.userId,
        },
      },
    });

    if (existing) {
      // Update existing feedback
      return prisma.messageFeedback.update({
        where: { id: existing.id },
        data: {
          rating: input.rating,
          thumbsUp: input.thumbsUp,
          thumbsDown: input.thumbsDown,
          feedbackType: input.feedbackType,
          comment: input.comment,
          accuracyRating: input.accuracyRating,
          clarityRating: input.clarityRating,
          completenessRating: input.completenessRating,
          relevanceRating: input.relevanceRating,
        },
      });
    }

    // Create new feedback
    return prisma.messageFeedback.create({
      data: {
        messageId: input.messageId,
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        rating: input.rating,
        thumbsUp: input.thumbsUp,
        thumbsDown: input.thumbsDown,
        feedbackType: input.feedbackType,
        comment: input.comment,
        accuracyRating: input.accuracyRating,
        clarityRating: input.clarityRating,
        completenessRating: input.completenessRating,
        relevanceRating: input.relevanceRating,
      },
    });
  }

  async getMessageFeedback(messageId: string, userId?: string): Promise<MessageFeedback[]> {
    return prisma.messageFeedback.findMany({
      where: {
        messageId,
        ...(userId && { userId }),
      },
    });
  }

  // Conversation Feedback
  async createConversationFeedback(
    input: CreateConversationFeedbackInput
  ): Promise<ConversationFeedback> {
    // Validate conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
    });

    if (!conversation || conversation.workspaceId !== input.workspaceId) {
      throw new Error('Unauthorized');
    }

    // Check if feedback exists
    const existing = await prisma.conversationFeedback.findUnique({
      where: {
        conversationId_userId: {
          conversationId: input.conversationId,
          userId: input.userId,
        },
      },
    });

    if (existing) {
      return prisma.conversationFeedback.update({
        where: { id: existing.id },
        data: {
          overallRating: input.overallRating,
          isUseful: input.isUseful,
          qualityScore: input.qualityScore,
          satisfactionScore: input.satisfactionScore,
          comment: input.comment,
          relevanceRating: input.relevanceRating,
          coherenceRating: input.coherenceRating,
          usefulnessRating: input.usefulnessRating,
        },
      });
    }

    return prisma.conversationFeedback.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        overallRating: input.overallRating,
        isUseful: input.isUseful,
        qualityScore: input.qualityScore,
        satisfactionScore: input.satisfactionScore,
        comment: input.comment,
        relevanceRating: input.relevanceRating,
        coherenceRating: input.coherenceRating,
        usefulnessRating: input.usefulnessRating,
      },
    });
  }

  // Corrections
  async createCorrection(input: CreateCorrectionInput): Promise<Correction> {
    // Validate message exists
    const message = await prisma.message.findUnique({
      where: { id: input.messageId },
      include: { conversation: true },
    });

    if (!message || message.conversation.workspaceId !== input.workspaceId) {
      throw new Error('Unauthorized');
    }

    return prisma.correction.create({
      data: {
        messageId: input.messageId,
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        originalContent: input.originalContent,
        correctedContent: input.correctedContent,
        reason: input.reason,
        correctionType: input.correctionType,
        confidence: input.confidence,
      },
    });
  }

  async getCorrections(messageId: string): Promise<Correction[]> {
    return prisma.correction.findMany({
      where: { messageId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Preferred Responses (for preference pairs)
  async createPreferredResponse(input: CreatePreferredResponseInput): Promise<PreferredResponse> {
    // Validate messages exist
    const [preferred, rejected] = await Promise.all([
      prisma.message.findUnique({ where: { id: input.preferredMessageId }, include: { conversation: true } }),
      prisma.message.findUnique({ where: { id: input.rejectedMessageId }, include: { conversation: true } }),
    ]);

    if (!preferred || !rejected) {
      throw new Error('One or both messages not found');
    }

    if (
      preferred.conversation.workspaceId !== input.workspaceId ||
      rejected.conversation.workspaceId !== input.workspaceId
    ) {
      throw new Error('Unauthorized');
    }

    return prisma.preferredResponse.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        preferredMessageId: input.preferredMessageId,
        rejectedMessageId: input.rejectedMessageId,
        reason: input.reason,
        confidence: input.confidence,
        preferenceType: 'HELPFULNESS', // Default
      },
    });
  }

  // Hallucination Reports
  async createHallucinationReport(
    input: CreateHallucinationReportInput
  ): Promise<HallucinationReport> {
    // Validate message
    const message = await prisma.message.findUnique({
      where: { id: input.messageId },
      include: { conversation: true },
    });

    if (!message || message.conversation.workspaceId !== input.workspaceId) {
      throw new Error('Unauthorized');
    }

    return prisma.hallucinationReport.create({
      data: {
        messageId: input.messageId,
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        hallucinatedText: input.hallucinatedText,
        factualCorrection: input.factualCorrection,
        severity: input.severity,
        category: input.category,
        evidence: input.evidence,
        sourceUrl: input.sourceUrl,
      },
    });
  }

  // Reward Signals (for RLHF training)
  async createRewardSignal(input: CreateRewardSignalInput): Promise<RewardSignal> {
    // Validate message
    const message = await prisma.message.findUnique({
      where: { id: input.messageId },
      include: { conversation: true },
    });

    if (!message || message.conversation.workspaceId !== input.workspaceId) {
      throw new Error('Unauthorized');
    }

    return prisma.rewardSignal.create({
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        reward: input.reward,
        rewardType: input.rewardType,
        comment: input.comment,
      },
    });
  }

  // Analytics aggregation
  async getWorkspaceFeedbackStats(workspaceId: string): Promise<{
    totalFeedback: number;
    averageRating: number;
    positiveCount: number;
    negativeCount: number;
  }> {
    const feedback = await prisma.messageFeedback.findMany({
      where: { workspaceId },
      select: { rating: true, thumbsUp: true, thumbsDown: true },
    });

    const totalFeedback = feedback.length;
    const ratings = feedback.filter((f) => f.rating).map((f) => f.rating!);
    const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const positiveCount = feedback.filter((f) => f.thumbsUp || (f.rating && f.rating >= 4)).length;
    const negativeCount = feedback.filter((f) => f.thumbsDown || (f.rating && f.rating <= 2)).length;

    return {
      totalFeedback,
      averageRating,
      positiveCount,
      negativeCount,
    };
  }

  async deleteMessageFeedback(feedbackId: string, workspaceId: string): Promise<void> {
    const feedback = await prisma.messageFeedback.findUnique({
      where: { id: feedbackId },
    });

    if (!feedback || feedback.workspaceId !== workspaceId) {
      throw new Error('Unauthorized');
    }

    await prisma.messageFeedback.delete({
      where: { id: feedbackId },
    });
  }
}

export const feedbackService = new FeedbackService()

