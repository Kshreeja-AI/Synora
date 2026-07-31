'use client'

import { Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@synora/design-system/utils'

interface StreamingMessageProps {
  content: string
  isStreaming: boolean
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  completedAt?: string
  error?: string
  role: 'assistant' | 'user'
  className?: string
}

export function StreamingMessage({
  content,
  isStreaming,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  completedAt,
  error,
  role,
  className,
}: StreamingMessageProps) {
  const isUser = role === 'user'

  return (
    <div
      className={cn(
        'flex gap-3 py-4 px-4 rounded-lg',
        isUser ? 'bg-blue-50 dark:bg-blue-950 ml-8' : 'bg-gray-50 dark:bg-gray-900 mr-8',
        className
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white'
        )}
      >
        {isUser ? 'U' : 'A'}
      </div>

      {/* Message Content */}
      <div className="flex-1 min-w-0">
        {/* Status Indicator */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {isUser ? 'You' : 'Assistant'}
          </span>
          {isStreaming && (
            <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
          )}
          {error && (
            <span className="text-xs text-red-500">Error</span>
          )}
        </div>

        {/* Message Text */}
        <div className="text-sm leading-relaxed break-words">
          {error ? (
            <p className="text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="text-gray-900 dark:text-gray-100">{content}</p>
          )}
        </div>

        {/* Metadata */}
        {!isUser && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
              {inputTokens > 0 && (
                <div>
                  <span className="font-medium">Input:</span> {inputTokens} tokens
                </div>
              )}
              {outputTokens > 0 && (
                <div>
                  <span className="font-medium">Output:</span> {outputTokens} tokens
                </div>
              )}
              {totalTokens > 0 && (
                <div>
                  <span className="font-medium">Total:</span> {totalTokens} tokens
                </div>
              )}
              {completedAt && (
                <div>
                  <span className="font-medium">Completed:</span>{' '}
                  {formatDistanceToNow(new Date(completedAt), { addSuffix: true })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {isStreaming && (
          <div className="mt-2">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse delay-100" />
              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse delay-200" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
