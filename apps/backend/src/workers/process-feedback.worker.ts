import { prisma } from '@synora/database'
import { RewardType } from '@prisma/client'
import { logger } from '../utils/logger'

export interface ProcessFeedbackJobData {
  feedbackId: string
  messageId: string
  conversationId: string
  workspaceId: string
  userId: string
  feedbackType: 'rating' | 'correction' | 'hallucination_report' | 'preference'
  feedbackData: Record<string, any>
}

export async function processMessageFeedback(data: ProcessFeedbackJobData): Promise<void> {
  const { feedbackId, messageId, conversationId, workspaceId, userId, feedbackType, feedbackData } = data

  try {
    logger.info(`[worker] Processing ${feedbackType} feedback ${feedbackId}`, {
      messageId,
      conversationId,
    })

    // Verify message and conversation exist
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    })

    if (!message) {
      throw new Error(`Message not found: ${messageId}`)
    }

    if (message.conversation.id !== conversationId) {
      throw new Error(`Message does not belong to conversation: ${conversationId}`)
    }

    // Process based on feedback type
    switch (feedbackType) {
      case 'rating':
        await processRatingFeedback(feedbackId, messageId, conversationId, workspaceId, userId, feedbackData)
        break
      case 'correction':
        await processCorrectionFeedback(feedbackId, messageId, conversationId, workspaceId, userId, feedbackData)
        break
      case 'hallucination_report':
        await processHallucinationReport(feedbackId, messageId, conversationId, workspaceId, userId, feedbackData)
        break
      case 'preference':
        await processPreferenceFeedback(feedbackId, messageId, conversationId, workspaceId, userId, feedbackData)
        break
    }

    logger.info(`[worker] Feedback processed successfully`, {
      feedbackId,
      feedbackType,
      messageId,
    })
  } catch (error) {
    logger.error(`[worker] Feedback processing failed`, {
      feedbackId,
      feedbackType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

async function processRatingFeedback(
  feedbackId: string,
  messageId: string,
  conversationId: string,
  workspaceId: string,
  userId: string,
  data: Record<string, any>
): Promise<void> {
  const { rating, thumbsUp, thumbsDown } = data

  // Create reward signal if rating is provided
  if (rating) {
    const rewardType = rating >= 4 ? RewardType.THUMBS_UP : rating <= 2 ? RewardType.THUMBS_DOWN : RewardType.RATING
    const reward = (rating - 3) / 2 // Normalize 1-5 to -1 to 1

    await prisma.rewardSignal.create({
      data: {
        conversationId,
        messageId,
        workspaceId,
        userId,
        reward,
        rewardType,
        comment: `Rating ${rating}/5`,
      },
    })

    logger.info(`[worker] Created reward signal for rating`, {
      feedbackId,
      messageId,
      rating,
      reward: reward.toFixed(2),
    })
  }

  // Track thumbs up/down as preference signals
  if (thumbsUp || thumbsDown) {
    const rewardType = thumbsUp ? RewardType.THUMBS_UP : RewardType.THUMBS_DOWN
    const reward = thumbsUp ? 1 : -1

    await prisma.rewardSignal.create({
      data: {
        conversationId,
        messageId,
        workspaceId,
        userId,
        reward,
        rewardType,
        comment: thumbsUp ? 'Thumbs up' : 'Thumbs down',
      },
    })
  }
}

async function processCorrectionFeedback(
  feedbackId: string,
  messageId: string,
  conversationId: string,
  workspaceId: string,
  userId: string,
  data: Record<string, any>
): Promise<void> {
  const { originalContent, correctedContent, correctionType, confidence } = data

  // Create training sample from correction
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  // Look for dataset to add correction as training sample
  const datasets = await prisma.dataset.findMany({
    where: { workspaceId, datasetType: 'DPO' },
    take: 1,
  })

  if (datasets.length > 0) {
    const dataset = datasets[0]

    await prisma.datasetSample.create({
      data: {
        datasetId: dataset.id,
        sourceType: 'CORRECTION',
        sourceId: messageId,
        input: originalContent,
        output: correctedContent,
        inputTokens: originalContent.split(/\s+/).length,
        outputTokens: correctedContent.split(/\s+/).length,
        qualityScore: confidence || 0.8,
        confidence: confidence || 0.8,
      },
    })

    logger.info(`[worker] Created training sample from correction`, {
      feedbackId,
      messageId,
      datasetId: dataset.id,
      correctionType,
    })
  }

  // Create reward signal for correction
  await prisma.rewardSignal.create({
    data: {
      conversationId,
      messageId,
      workspaceId,
      userId,
      reward: confidence ? confidence : 0.8,
      rewardType: RewardType.CORRECTION,
      comment: `${correctionType}: ${originalContent.substring(0, 50)}...`,
    },
  })
}

async function processHallucinationReport(
  feedbackId: string,
  messageId: string,
  conversationId: string,
  workspaceId: string,
  userId: string,
  data: Record<string, any>
): Promise<void> {
  const { severity, category, evidence, sourceUrl } = data

  // Create reward signal for hallucination (negative reward)
  const severityReward = {
    LOW: -0.3,
    MEDIUM: -0.6,
    HIGH: -0.9,
    CRITICAL: -1.0,
  }

  await prisma.rewardSignal.create({
    data: {
      conversationId,
      messageId,
      workspaceId,
      userId,
      reward: severityReward[severity as keyof typeof severityReward] || -0.5,
      rewardType: RewardType.CUSTOM,
      comment: `Hallucination (${severity}): ${category} - ${evidence || sourceUrl || 'No evidence provided'}`,
    },
  })

  logger.info(`[worker] Processed hallucination report`, {
    feedbackId,
    messageId,
    severity,
    category,
    hasEvidence: !!evidence,
    hasSource: !!sourceUrl,
  })
}

async function processPreferenceFeedback(
  feedbackId: string,
  messageId: string,
  conversationId: string,
  workspaceId: string,
  userId: string,
  data: Record<string, any>
): Promise<void> {
  const { preferredMessageId, rejectedMessageId, preferenceType, confidence } = data

  // Fetch both messages to create training data
  const [preferred, rejected] = await Promise.all([
    prisma.message.findUnique({ where: { id: preferredMessageId } }),
    prisma.message.findUnique({ where: { id: rejectedMessageId } }),
  ])

  if (!preferred || !rejected) {
    throw new Error('One or both messages not found for preference')
  }

  // Look for dataset to add preference
  const datasets = await prisma.dataset.findMany({
    where: { workspaceId, datasetType: 'DPO' },
    take: 1,
  })

  if (datasets.length > 0) {
    const dataset = datasets[0]

    // Create samples if they don't exist
    const [prefSample, rejSample] = await Promise.all([
      prisma.datasetSample.upsert({
        where: { id: `${preferredMessageId}-sample` },
        update: {},
        create: {
          id: `${preferredMessageId}-sample`,
          datasetId: dataset.id,
          sourceType: 'MESSAGE',
          sourceId: preferredMessageId,
          input: preferred.content.substring(0, 100),
          output: preferred.content,
          inputTokens: 10,
          outputTokens: preferred.content.split(/\s+/).length,
          qualityScore: 0.9,
        },
      }),
      prisma.datasetSample.upsert({
        where: { id: `${rejectedMessageId}-sample` },
        update: {},
        create: {
          id: `${rejectedMessageId}-sample`,
          datasetId: dataset.id,
          sourceType: 'MESSAGE',
          sourceId: rejectedMessageId,
          input: rejected.content.substring(0, 100),
          output: rejected.content,
          inputTokens: 10,
          outputTokens: rejected.content.split(/\s+/).length,
          qualityScore: 0.5,
        },
      }),
    ])

    // Create human preference record
    await prisma.humanPreference.create({
      data: {
        datasetId: dataset.id,
        workspaceId,
        preferredSampleId: prefSample.id,
        rejectedSampleId: rejSample.id,
        annotatorId: userId,
        confidence: confidence || 0.8,
      },
    })

    logger.info(`[worker] Created human preference pair for DPO`, {
      feedbackId,
      datasetId: dataset.id,
      preferenceType,
      confidence,
    })
  }

  // Create reward signals for both messages
  await Promise.all([
    prisma.rewardSignal.create({
      data: {
        conversationId,
        messageId: preferredMessageId,
        workspaceId,
        userId,
        reward: confidence ? confidence : 0.8,
        rewardType: RewardType.PREFERENCE,
        comment: `Preferred (${preferenceType})`,
      },
    }),
    prisma.rewardSignal.create({
      data: {
        conversationId,
        messageId: rejectedMessageId,
        workspaceId,
        userId,
        reward: -(confidence ? confidence : 0.8),
        rewardType: RewardType.PREFERENCE,
        comment: `Rejected (${preferenceType})`,
      },
    }),
  ])
}
