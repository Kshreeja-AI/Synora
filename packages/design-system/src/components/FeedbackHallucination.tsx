'use client'

import React, { useState } from 'react'
import { AlertTriangle, Link as LinkIcon } from 'lucide-react'
import { Button } from './Button'

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

export function FeedbackHallucination({
  messageContent,
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

  const severityColors = {
    LOW: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800',
    MEDIUM: 'bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800',
    HIGH: 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',
    CRITICAL: 'bg-red-100 border-red-300 dark:bg-red-900 dark:border-red-700',
  }

  return (
    <div className={`space-y-3 rounded-lg border-2 p-4 ${severityColors[severity as keyof typeof severityColors]}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Report a hallucination</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Hallucinated text (quote from message)
        </label>
        <textarea
          value={hallucinatedText}
          onChange={(e) => setHallucinatedText(e.target.value)}
          placeholder="Copy the incorrect text from the message..."
          disabled={isLoading}
          className="w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-xs placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
          rows={2}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Factual correction
        </label>
        <textarea
          value={factualCorrection}
          onChange={(e) => setFactualCorrection(e.target.value)}
          placeholder="What is the correct information?"
          disabled={isLoading}
          className="w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-xs placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Severity
          </label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            disabled={isLoading}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {SEVERITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isLoading}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
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
        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Evidence (optional)
        </label>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Why is this incorrect? (e.g., citation, fact check)"
          disabled={isLoading}
          className="w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-xs placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
          rows={2}
        />
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300">
          <LinkIcon size={12} />
          Source URL (optional)
        </label>
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://example.com/fact-check"
          disabled={isLoading}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
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
