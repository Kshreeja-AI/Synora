'use client'

import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from './Button'

const PREFERENCE_TYPES = ['ACCURACY', 'CLARITY', 'HELPFULNESS', 'RELEVANCE', 'STYLE', 'TONE', 'COMPLETENESS', 'SAFETY']

export interface FeedbackPreferenceProps {
  messageA: {
    id: string
    content: string
    label?: string
  }
  messageB: {
    id: string
    content: string
    label?: string
  }
  onSubmit: (data: {
    preferredMessageId: string
    rejectedMessageId: string
    preferenceType: string
    reason?: string
    confidence?: number
  }) => Promise<void>
  onCancel?: () => void
  isLoading?: boolean
}

export function FeedbackPreference({
  messageA,
  messageB,
  onSubmit,
  onCancel,
  isLoading = false,
}: FeedbackPreferenceProps) {
  const [preference, setPreference] = useState<'A' | 'B' | null>(null)
  const [preferenceType, setPreferenceType] = useState(PREFERENCE_TYPES[0])
  const [reason, setReason] = useState('')
  const [confidence, setConfidence] = useState(0.8)

  const handleSubmit = async () => {
    if (!preference) return

    const [preferredId, rejectedId] = preference === 'A' ? [messageA.id, messageB.id] : [messageB.id, messageA.id]

    await onSubmit({
      preferredMessageId: preferredId,
      rejectedMessageId: rejectedId,
      preferenceType,
      reason: reason || undefined,
      confidence,
    })

    setPreference(null)
    setReason('')
    setConfidence(0.8)
  }

  const MessageCard = ({ message, selected }: { message: typeof messageA; selected: boolean }) => (
    <div
      className={`flex-1 rounded-lg border-2 p-3 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'
      }`}
    >
      {message.label && (
        <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{message.label}</p>
      )}
      <p className="text-xs text-slate-700 dark:text-slate-300">{message.content}</p>
    </div>
  )

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-900">
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Which response is better?</p>

      <div className="flex gap-2">
        <button
          onClick={() => setPreference('A')}
          disabled={isLoading}
          className="flex-1 text-left"
        >
          <MessageCard message={messageA} selected={preference === 'A'} />
        </button>

        <div className="flex items-center">
          <ChevronRight size={20} className="text-slate-400 dark:text-slate-600" />
        </div>

        <button
          onClick={() => setPreference('B')}
          disabled={isLoading}
          className="flex-1 text-left"
        >
          <MessageCard message={messageB} selected={preference === 'B'} />
        </button>
      </div>

      {preference && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Why did you prefer this response?
            </label>
            <select
              value={preferenceType}
              onChange={(e) => setPreferenceType(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {PREFERENCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Additional reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain your preference..."
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
        </>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={isLoading || !preference}
          size="sm"
          className="flex-1"
        >
          {isLoading ? 'Submitting...' : 'Submit Preference'}
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
