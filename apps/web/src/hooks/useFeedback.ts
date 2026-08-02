'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  feedbackApi,
  type ConversationFeedbackInput,
  type CorrectionInput,
  type HallucinationReportInput,
  type PreferredResponseInput,
} from '@/lib/api/feedback'

export function useMessageFeedback(workspaceId: string) {
  const [isLoading, setIsLoading] = useState(false)

  const submitRating = async (
    conversationId: string,
    messageId: string,
    data: {
      rating?: number
      isHelpful?: boolean
      thumbsUp?: boolean
      thumbsDown?: boolean
    }
  ) => {
    setIsLoading(true)
    try {
      await feedbackApi.createMessageFeedback(workspaceId, {
        messageId,
        conversationId,
        feedbackType: data.rating ? 'RATING' : data.thumbsUp ? 'HELPFUL' : data.thumbsDown ? 'UNHELPFUL' : 'HELPFUL',
        ...data,
      })

      toast.success('Feedback submitted! Thank you for your feedback!')
    } catch (error) {
      toast.error('Failed to submit feedback. Please try again.')
      console.error('Feedback submission error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const submitCorrection = async (conversationId: string, correction: Omit<CorrectionInput, 'conversationId'>) => {
    setIsLoading(true)
    try {
      await feedbackApi.createCorrection(workspaceId, {
        messageId: correction.messageId,
        conversationId,
        originalContent: correction.originalContent,
        correctedContent: correction.correctedContent,
        correctionType: correction.correctionType,
        reason: correction.reason,
        confidence: correction.confidence,
      })

      toast.success('Correction submitted! Thank you for helping us improve!')
    } catch (error) {
      toast.error('Failed to submit correction. Please try again.')
      console.error('Correction submission error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const reportHallucination = async (conversationId: string, report: HallucinationReportInput) => {
    setIsLoading(true)
    try {
      await feedbackApi.reportHallucination(workspaceId, {
        messageId: report.messageId,
        conversationId,
        hallucinatedText: report.hallucinatedText,
        factualCorrection: report.factualCorrection,
        severity: report.severity,
        category: report.category,
        evidence: report.evidence,
        sourceUrl: report.sourceUrl,
      })

      toast.success('Hallucination reported! Thank you for reporting this issue!')
    } catch (error) {
      toast.error('Failed to report hallucination. Please try again.')
      console.error('Hallucination report error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const submitPreference = async (conversationId: string, preference: PreferredResponseInput) => {
    setIsLoading(true)
    try {
      await feedbackApi.createPreferredResponse(workspaceId, {
        conversationId,
        preferredMessageId: preference.preferredMessageId,
        rejectedMessageId: preference.rejectedMessageId,
        preferenceType: preference.preferenceType,
        reason: preference.reason,
        confidence: preference.confidence,
      })

      toast.success('Preference recorded! Your feedback helps us train better models!')
    } catch (error) {
      toast.error('Failed to submit preference. Please try again.')
      console.error('Preference submission error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return {
    isLoading,
    submitRating,
    submitCorrection,
    reportHallucination,
    submitPreference,
  }
}

export function useConversationFeedback(workspaceId: string) {
  const [isLoading, setIsLoading] = useState(false)

  const submitFeedback = async (conversationId: string, data: ConversationFeedbackInput) => {
    setIsLoading(true)
    try {
      await feedbackApi.createConversationFeedback(workspaceId, {
        conversationId,
        overallRating: data.overallRating,
        isUseful: data.isUseful,
        qualityScore: data.qualityScore,
        satisfactionScore: data.satisfactionScore,
        comment: data.comment,
        relevanceRating: data.relevanceRating,
        coherenceRating: data.coherenceRating,
        usefulnessRating: data.usefulnessRating,
      })

      toast.success('Feedback submitted! Thank you for rating this conversation!')
    } catch (error) {
      toast.error('Failed to submit feedback. Please try again.')
      console.error('Feedback submission error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return {
    isLoading,
    submitFeedback,
  }
}
