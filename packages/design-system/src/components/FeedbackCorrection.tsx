'use client'

import React, { useId, useState } from 'react'
import { Button } from './Button'

const CORRECTION_TYPES = [
  'FACTUAL_ERROR',
  'GRAMMAR',
  'CLARITY',
  'TONE',
  'COMPLETENESS',
  'STYLE',
  'TECHNICAL',
  'OTHER',
]

/** Shared look for the compact fields in the feedback forms. Token-only, so
 *  both themes follow tokens.css without `dark:` overrides. */
export const feedbackFieldClass =
  'w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60'
export const feedbackLabelClass = 'mb-1 block text-xs font-medium text-foreground'

export interface FeedbackCorrectionProps {
  originalContent: string
  onSubmit: (data: {
    correctedContent: string
    correctionType: string
    reason?: string
    confidence?: number
  }) => Promise<void>
  onCancel?: () => void
  isLoading?: boolean
}

export function FeedbackCorrection({
  originalContent,
  onSubmit,
  onCancel,
  isLoading = false,
}: FeedbackCorrectionProps) {
  const [correctedContent, setCorrectedContent] = useState('')
  const [correctionType, setCorrectionType] = useState(CORRECTION_TYPES[0])
  const [reason, setReason] = useState('')
  const [confidence, setConfidence] = useState(0.8)
  const id = useId()

  const handleSubmit = async () => {
    if (!correctedContent.trim()) return

    await onSubmit({
      correctedContent,
      correctionType,
      reason: reason || undefined,
      confidence,
    })

    setCorrectedContent('')
    setReason('')
    setConfidence(0.8)
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <div>
        <p className={feedbackLabelClass}>Original</p>
        <div className="rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
          {originalContent}
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-corrected`} className={feedbackLabelClass}>
          Corrected
        </label>
        <textarea
          id={`${id}-corrected`}
          value={correctedContent}
          onChange={(e) => setCorrectedContent(e.target.value)}
          placeholder="Enter the corrected version..."
          disabled={isLoading}
          className={`${feedbackFieldClass} resize-none p-2`}
          rows={3}
        />
      </div>

      <div>
        <label htmlFor={`${id}-type`} className={feedbackLabelClass}>
          Type of correction
        </label>
        <select
          id={`${id}-type`}
          value={correctionType}
          onChange={(e) => setCorrectionType(e.target.value)}
          disabled={isLoading}
          className={feedbackFieldClass}
        >
          {CORRECTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-reason`} className={feedbackLabelClass}>
          Reason (optional)
        </label>
        <input
          id={`${id}-reason`}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this correction?"
          disabled={isLoading}
          className={feedbackFieldClass}
        />
      </div>

      <div>
        <label htmlFor={`${id}-confidence`} className={feedbackLabelClass}>
          Confidence: {(confidence * 100).toFixed(0)}%
        </label>
        <input
          id={`${id}-confidence`}
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={confidence}
          onChange={(e) => setConfidence(parseFloat(e.target.value))}
          disabled={isLoading}
          className="w-full accent-primary"
        />
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={isLoading || !correctedContent.trim()}
          size="sm"
          className="flex-1"
        >
          {isLoading ? 'Submitting...' : 'Submit Correction'}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} variant="outline" size="sm" disabled={isLoading}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
