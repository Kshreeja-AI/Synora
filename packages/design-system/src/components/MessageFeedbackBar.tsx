'use client'

import React, { useState } from 'react'
import { MessageCircle, Flag, Zap, MoreVertical, X } from 'lucide-react'
import { Button } from './Button'
import { FeedbackRating } from './FeedbackRating'
import { FeedbackCorrection } from './FeedbackCorrection'
import { FeedbackHallucination } from './FeedbackHallucination'

export type FeedbackMode = 'rating' | 'correction' | 'hallucination' | null

export interface MessageFeedbackBarProps {
  messageId: string
  messageContent: string
  onRatingSubmit?: (data: {
    rating?: number
    isHelpful?: boolean
    thumbsUp?: boolean
    thumbsDown?: boolean
  }) => Promise<void>
  onCorrectionSubmit?: (data: {
    correctedContent: string
    correctionType: string
    reason?: string
    confidence?: number
  }) => Promise<void>
  onHallucinationSubmit?: (data: {
    hallucinatedText: string
    factualCorrection: string
    severity: string
    category: string
    evidence?: string
    sourceUrl?: string
  }) => Promise<void>
  isLoading?: boolean
  compact?: boolean
}

export function MessageFeedbackBar({
  messageId,
  messageContent,
  onRatingSubmit,
  onCorrectionSubmit,
  onHallucinationSubmit,
  isLoading = false,
  compact = false,
}: MessageFeedbackBarProps) {
  const [mode, setMode] = useState<FeedbackMode>(null)

  const handleRatingSubmit = async (rating: number, isHelpful?: boolean, thumbsUp?: boolean, thumbsDown?: boolean) => {
    if (onRatingSubmit) {
      await onRatingSubmit({ rating, isHelpful, thumbsUp, thumbsDown })
      setMode(null)
    }
  }

  const handleCorrectionSubmit = async (data: {
    correctedContent: string
    correctionType: string
    reason?: string
    confidence?: number
  }) => {
    if (onCorrectionSubmit) {
      await onCorrectionSubmit(data)
      setMode(null)
    }
  }

  const handleHallucinationSubmit = async (data: {
    hallucinatedText: string
    factualCorrection: string
    severity: string
    category: string
    evidence?: string
    sourceUrl?: string
  }) => {
    if (onHallucinationSubmit) {
      await onHallucinationSubmit(data)
      setMode(null)
    }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {onRatingSubmit && (
          <button
            onClick={() => setMode(mode === 'rating' ? null : 'rating')}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="Rate this response"
          >
            <MessageCircle size={16} />
          </button>
        )}
        {onCorrectionSubmit && (
          <button
            onClick={() => setMode(mode === 'correction' ? null : 'correction')}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="Suggest a correction"
          >
            <Zap size={16} />
          </button>
        )}
        {onHallucinationSubmit && (
          <button
            onClick={() => setMode(mode === 'hallucination' ? null : 'hallucination')}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="Report hallucination"
          >
            <Flag size={16} />
          </button>
        )}
      </div>
    )
  }

  if (mode) {
    return (
      <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {mode === 'rating' && 'Rate this response'}
            {mode === 'correction' && 'Suggest a correction'}
            {mode === 'hallucination' && 'Report hallucination'}
          </p>
          <button
            onClick={() => setMode(null)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={14} />
          </button>
        </div>

        {mode === 'rating' && onRatingSubmit && (
          <FeedbackRating
            onSubmit={handleRatingSubmit}
            onCancel={() => setMode(null)}
            isLoading={isLoading}
            showHelpfulness={true}
            showThumbs={true}
          />
        )}

        {mode === 'correction' && onCorrectionSubmit && (
          <FeedbackCorrection
            originalContent={messageContent}
            onSubmit={handleCorrectionSubmit}
            onCancel={() => setMode(null)}
            isLoading={isLoading}
          />
        )}

        {mode === 'hallucination' && onHallucinationSubmit && (
          <FeedbackHallucination
            messageContent={messageContent}
            onSubmit={handleHallucinationSubmit}
            onCancel={() => setMode(null)}
            isLoading={isLoading}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {onRatingSubmit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode('rating')}
          disabled={isLoading}
          className="gap-1.5 text-xs"
        >
          <MessageCircle size={14} />
          Rate
        </Button>
      )}
      {onCorrectionSubmit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode('correction')}
          disabled={isLoading}
          className="gap-1.5 text-xs"
        >
          <Zap size={14} />
          Correct
        </Button>
      )}
      {onHallucinationSubmit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode('hallucination')}
          disabled={isLoading}
          className="gap-1.5 text-xs"
        >
          <Flag size={14} />
          Report
        </Button>
      )}
    </div>
  )
}
