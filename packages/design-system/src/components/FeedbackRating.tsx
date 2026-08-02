'use client'

import React, { useState } from 'react'
import { Star, ThumbsUp, ThumbsDown } from 'lucide-react'
import { Button } from './Button'

export interface FeedbackRatingProps {
  onSubmit: (rating: number, isHelpful?: boolean, thumbsUp?: boolean, thumbsDown?: boolean) => Promise<void>
  onCancel?: () => void
  isLoading?: boolean
  showHelpfulness?: boolean
  showThumbs?: boolean
}

export function FeedbackRating({
  onSubmit,
  onCancel,
  isLoading = false,
  showHelpfulness = true,
  showThumbs = true,
}: FeedbackRatingProps) {
  const [rating, setRating] = useState<number | null>(null)
  const [isHelpful, setIsHelpful] = useState<boolean | null>(null)
  const [thumbsUp, setThumbsUp] = useState<boolean | null>(null)
  const [hoveredRating, setHoveredRating] = useState<number | null>(null)

  const handleSubmit = async () => {
    if (rating === null && !showThumbs) return

    await onSubmit(rating || 0, isHelpful || undefined, thumbsUp || undefined, thumbsUp === false)
    setRating(null)
    setIsHelpful(null)
    setThumbsUp(null)
  }

  const ratingLabels = ['Not helpful', 'Unhelpful', 'Neutral', 'Helpful', 'Very helpful']

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-900">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Was this helpful?</p>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(null)}
              className="transition-transform hover:scale-110"
              disabled={isLoading}
            >
              <Star
                size={24}
                className={`${
                  (hoveredRating !== null ? star <= hoveredRating : star <= (rating || 0))
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-slate-300 dark:text-slate-600'
                } transition-colors`}
              />
            </button>
          ))}
        </div>
        {rating && (
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {ratingLabels[rating - 1]}
          </p>
        )}
      </div>

      {showHelpfulness && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Was this accurate?</p>
          <div className="flex gap-2">
            <Button
              variant={isHelpful === true ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setIsHelpful(true)}
              disabled={isLoading}
            >
              Yes
            </Button>
            <Button
              variant={isHelpful === false ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setIsHelpful(false)}
              disabled={isLoading}
            >
              No
            </Button>
          </div>
        </div>
      )}

      {showThumbs && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Quick reaction</p>
          <div className="flex gap-2">
            <button
              onClick={() => setThumbsUp(true)}
              disabled={isLoading}
              className={`rounded-lg border p-2 transition-colors ${
                thumbsUp === true
                  ? 'border-green-500 bg-green-50 dark:bg-green-950'
                  : 'border-slate-200 hover:border-green-300 dark:border-slate-700'
              }`}
            >
              <ThumbsUp
                size={20}
                className={thumbsUp === true ? 'text-green-600 dark:text-green-400' : 'text-slate-600 dark:text-slate-400'}
              />
            </button>
            <button
              onClick={() => setThumbsUp(false)}
              disabled={isLoading}
              className={`rounded-lg border p-2 transition-colors ${
                thumbsUp === false
                  ? 'border-red-500 bg-red-50 dark:bg-red-950'
                  : 'border-slate-200 hover:border-red-300 dark:border-slate-700'
              }`}
            >
              <ThumbsDown
                size={20}
                className={thumbsUp === false ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-400'}
              />
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={isLoading || (rating === null && !showThumbs)}
          size="sm"
          className="flex-1"
        >
          {isLoading ? 'Sending...' : 'Submit'}
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
