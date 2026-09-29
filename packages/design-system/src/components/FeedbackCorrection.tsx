'use client'

import React, { useState } from 'react'
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
    <div className="space-y-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-900">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Original
        </label>
        <div className="rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {originalContent}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Corrected
        </label>
        <textarea
          value={correctedContent}
          onChange={(e) => setCorrectedContent(e.target.value)}
          placeholder="Enter the corrected version..."
          disabled={isLoading}
          className="w-full resize-none rounded-md border border-slate-200 bg-white p-2 text-xs placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
          rows={3}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Type of correction
        </label>
        <select
          value={correctionType}
          onChange={(e) => setCorrectionType(e.target.value)}
          disabled={isLoading}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {CORRECTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Reason (optional)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this correction?"
          disabled={isLoading}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Confidence: {(confidence * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={confidence}
          onChange={(e) => setConfidence(parseFloat(e.target.value))}
          disabled={isLoading}
          className="w-full"
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
