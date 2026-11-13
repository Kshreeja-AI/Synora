'use client'

import React, { useId, useState } from 'react'
import { AlertTriangle, Link as LinkIcon } from 'lucide-react'
import { Button } from './Button'
import { feedbackFieldClass, feedbackLabelClass } from './FeedbackCorrection'

const SEVERITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const CATEGORIES = [
  'FACTUAL_ERROR',
  'FALSE_CITATION',
  'INVENTED_INFORMATION',
  'OUTDATED_INFORMATION',
  'LOGICAL_ERROR',
]

export interface FeedbackHallucinationProps {
  messageContent: string
  onSubmit: (data: {
    hallucinatedText: string
    factualCorrection: string
    severity: string
    category: string
    evidence?: string
    sourceUrl?: string
  }) => Promise<void>
  onCancel?: () => void
  isLoading?: boolean
}

/* Severity tints the panel through the warning/destructive tokens. The
   selected level is also stated in the Severity field, so colour is never
   the only carrier of it. */
const severityColors = {
  LOW: 'bg-warning/5 border-warning/30',
  MEDIUM: 'bg-warning/10 border-warning/50',
  HIGH: 'bg-destructive/5 border-destructive/40',
  CRITICAL: 'bg-destructive/10 border-destructive/70',
}

export function FeedbackHallucination({
  messageContent: _unused,
  onSubmit,
  onCancel,
  isLoading = false,
}: FeedbackHallucinationProps) {
  const [hallucinatedText, setHallucinatedText] = useState('')
  const [factualCorrection, setFactualCorrection] = useState('')
  const [severity, setSeverity] = useState(SEVERITY_LEVELS[1])
  const [category, setCategory] = useState(CATEGORIES[0])
  const [evidence, setEvidence] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const id = useId()

  const handleSubmit = async () => {
    if (!hallucinatedText.trim() || !factualCorrection.trim()) return

    await onSubmit({
      hallucinatedText,
      factualCorrection,
      severity,
      category,
      evidence: evidence || undefined,
      sourceUrl: sourceUrl || undefined,
    })

    setHallucinatedText('')
    setFactualCorrection('')
    setSeverity(SEVERITY_LEVELS[1])
    setCategory(CATEGORIES[0])
    setEvidence('')
    setSourceUrl('')
  }

  return (
    <div className={`space-y-3 rounded-lg border-2 p-4 ${severityColors[severity as keyof typeof severityColors]}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-shrink-0 text-destructive" />
        <p className="text-xs font-medium text-foreground">Report a hallucination</p>
      </div>

      <div>
        <label htmlFor={`${id}-quote`} className={feedbackLabelClass}>
          Hallucinated text (quote from message)
        </label>
        <textarea
          id={`${id}-quote`}
          value={hallucinatedText}
          onChange={(e) => setHallucinatedText(e.target.value)}
          placeholder="Copy the incorrect text from the message..."
          disabled={isLoading}
          className={`${feedbackFieldClass} resize-none p-2`}
          rows={2}
        />
      </div>

      <div>
        <label htmlFor={`${id}-correction`} className={feedbackLabelClass}>
          Factual correction
        </label>
        <textarea
          id={`${id}-correction`}
          value={factualCorrection}
          onChange={(e) => setFactualCorrection(e.target.value)}
          placeholder="What is the correct information?"
          disabled={isLoading}
          className={`${feedbackFieldClass} resize-none p-2`}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-severity`} className={feedbackLabelClass}>
            Severity
          </label>
          <select
            id={`${id}-severity`}
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            disabled={isLoading}
            className={feedbackFieldClass}
          >
            {SEVERITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-category`} className={feedbackLabelClass}>
            Category
          </label>
          <select
            id={`${id}-category`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isLoading}
            className={feedbackFieldClass}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-evidence`} className={feedbackLabelClass}>
          Evidence (optional)
        </label>
        <textarea
          id={`${id}-evidence`}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Why is this incorrect? (e.g., citation, fact check)"
          disabled={isLoading}
          className={`${feedbackFieldClass} resize-none p-2`}
          rows={2}
        />
      </div>

      <div>
        <label htmlFor={`${id}-source`} className={`${feedbackLabelClass} flex items-center gap-1`}>
          <LinkIcon size={12} aria-hidden />
          Source URL (optional)
        </label>
        <input
          id={`${id}-source`}
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://example.com/fact-check"
          disabled={isLoading}
          className={feedbackFieldClass}
        />
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={isLoading || !hallucinatedText.trim() || !factualCorrection.trim()}
          size="sm"
          className="flex-1"
        >
          {isLoading ? 'Reporting...' : 'Report Hallucination'}
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
