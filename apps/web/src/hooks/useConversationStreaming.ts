'use client'

import { useCallback, useRef, useState } from 'react'
import type { Message } from '@synora/database'

export interface StreamingMessage {
  id: string
  conversationId: string
  content: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  completedAt: string
}

interface UseConversationStreamingOptions {
  workspaceId: string
  conversationId: string
}

interface StreamingState {
  isStreaming: boolean
  currentMessage: string
  inputTokens: number
  outputTokens: number
  completedAt?: string
  error?: string
}

export function useConversationStreaming(options: UseConversationStreamingOptions) {
  const { workspaceId, conversationId } = options
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    currentMessage: '',
    inputTokens: 0,
    outputTokens: 0,
  })

  const eventSourceRef = useRef<EventSource | null>(null)

  const startStreaming = useCallback(
    (messageId: string) => {
      setState((prev) => ({
        ...prev,
        isStreaming: true,
        currentMessage: '',
        inputTokens: 0,
        outputTokens: 0,
        error: undefined,
      }))

      const streamUrl = `/api/${workspaceId}/conversations/${conversationId}/stream?messageId=${messageId}`

      try {
        const eventSource = new EventSource(streamUrl)
        eventSourceRef.current = eventSource

        eventSource.addEventListener('token', (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data)
            setState((prev) => ({
              ...prev,
              currentMessage: prev.currentMessage + (data.token || ''),
              inputTokens: data.inputTokens ?? prev.inputTokens,
              outputTokens: data.outputTokens ?? prev.outputTokens,
            }))
          } catch (err) {
            console.error('Failed to parse token event', err)
          }
        })

        eventSource.addEventListener('done', (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data)
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              inputTokens: data.inputTokens,
              outputTokens: data.outputTokens,
              completedAt: data.completedAt,
            }))
            eventSource.close()
            eventSourceRef.current = null
          } catch (err) {
            console.error('Failed to parse done event', err)
          }
        })

        eventSource.addEventListener('error', (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data)
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              error: data.error || 'Stream error occurred',
            }))
          } catch (err) {
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              error: 'Failed to parse error event',
            }))
          }
          eventSource.close()
          eventSourceRef.current = null
        })

        eventSource.onerror = () => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: 'Connection error',
          }))
          eventSource.close()
          eventSourceRef.current = null
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: errorMessage,
        }))
      }
    },
    [workspaceId, conversationId]
  )

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setState((prev) => ({
      ...prev,
      isStreaming: false,
    }))
  }, [])

  const resetStreaming = useCallback(() => {
    stopStreaming()
    setState({
      isStreaming: false,
      currentMessage: '',
      inputTokens: 0,
      outputTokens: 0,
      error: undefined,
    })
  }, [stopStreaming])

  return {
    ...state,
    startStreaming,
    stopStreaming,
    resetStreaming,
  }
}
