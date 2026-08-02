import { api } from './client'

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

export interface FeedbackStats {
  totalFeedback: number
  helpfulCount: number
  unhelpfulCount: number
  averageRating: number
}

export const feedbackApi = {
  async createMessageFeedback(workspaceId: string, input: MessageFeedbackInput) {
    return api.post(`/workspaces/${workspaceId}/feedback/messages`, {
      ...input,
      feedbackType: input.feedbackType,
    })
  },

  async listMessageFeedback(
    workspaceId: string,
    conversationId: string,
    options?: { skip?: number; take?: number }
  ) {
    const params = new URLSearchParams()
    if (options?.skip !== undefined) params.append('skip', String(options.skip))
    if (options?.take !== undefined) params.append('take', String(options.take))

    const queryString = params.toString()
    const url = `/workspaces/${workspaceId}/conversations/${conversationId}/feedback/messages${queryString ? `?${queryString}` : ''}`

    return api.get(url)
  },

  async getFeedbackStats(workspaceId: string, conversationId: string) {
    return api.get<FeedbackStats>(
      `/workspaces/${workspaceId}/conversations/${conversationId}/feedback/stats`
    )
  },

  async createConversationFeedback(workspaceId: string, input: ConversationFeedbackInput) {
    return api.post(`/workspaces/${workspaceId}/feedback/conversations`, input)
  },

  async createCorrection(workspaceId: string, input: CorrectionInput) {
    return api.post(`/workspaceId/feedback/corrections`, {
      messageId: input.messageId,
      conversationId: input.conversationId,
      originalContent: input.originalContent,
      correctedContent: input.correctedContent,
      correctionType: input.correctionType,
      reason: input.reason,
      confidence: input.confidence,
    })
  },

  async reportHallucination(workspaceId: string, input: HallucinationReportInput) {
    return api.post(`/workspaces/${workspaceId}/feedback/hallucinations`, {
      messageId: input.messageId,
      conversationId: input.conversationId,
      hallucinatedText: input.hallucinatedText,
      factualCorrection: input.factualCorrection,
      severity: input.severity,
      category: input.category,
      evidence: input.evidence,
      sourceUrl: input.sourceUrl,
    })
  },

  async createPreferredResponse(workspaceId: string, input: PreferredResponseInput) {
    return api.post(`/workspaces/${workspaceId}/feedback/preferences`, {
      conversationId: input.conversationId,
      preferredMessageId: input.preferredMessageId,
      rejectedMessageId: input.rejectedMessageId,
      preferenceType: input.preferenceType,
      reason: input.reason,
      confidence: input.confidence,
    })
  },
}
