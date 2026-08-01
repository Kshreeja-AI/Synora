'use client'

import { useState, useRef, useEffect } from 'react'
import { useConversationStreaming } from '@/hooks/useConversationStreaming'
import { StreamingMessage } from './StreamingMessage'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@synora/design-system'

// Define locally to avoid circular imports from @synora/database
interface Message {
  id: string
  conversationId: string
  content: string
  role: 'user' | 'assistant' | 'system'
  inputTokens?: number
  outputTokens?: number
  createdAt: string
}

interface ChatInterfaceProps {
  conversationId: string
  workspaceId: string
  initialMessages?: Message[]
  onMessageSent?: (messageId: string) => void
}

export function ChatInterface({
  conversationId,
  workspaceId,
  initialMessages = [],
  onMessageSent,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const streaming = useConversationStreaming({
    workspaceId,
    conversationId,
  })

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streaming.currentMessage])

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    try {
      setIsLoading(true)
      const userContent = inputValue.trim()
      setInputValue('')

      // Create optimistic user message
      const userMessage: Message = {
        id: `msg-temp-${Date.now()}`,
        conversationId,
        content: userContent,
        role: 'user',
        createdAt: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, userMessage])

      // Send message to backend
      const response = await fetch(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: userContent,
            role: 'user',
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`)
      }

      const data = await response.json()
      const actualMessageId = data.data?.id || data.id

      // Update optimistic message with real ID
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === userMessage.id
            ? { ...msg, id: actualMessageId }
            : msg
        )
      )

      // Start streaming response
      if (actualMessageId) {
        const assistantMessage: Message = {
          id: `msg-assistant-${Date.now()}`,
          conversationId,
          content: '',
          role: 'assistant',
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, assistantMessage])

        streaming.startStreaming(actualMessageId)
        onMessageSent?.(actualMessageId)
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      // Optionally show error toast here
    } finally {
      setIsLoading(false)
    }
  }

  // Update last message with streaming content
  useEffect(() => {
    if (streaming.currentMessage && messages.length > 0) {
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1]
        if (lastMsg.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              content: streaming.currentMessage,
              inputTokens: streaming.inputTokens,
              outputTokens: streaming.outputTokens,
              completedAt: streaming.completedAt,
            },
          ]
        }
        return prev
      })
    }
  }, [streaming.currentMessage, streaming.inputTokens, streaming.outputTokens, streaming.completedAt])

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">Start a conversation</p>
              <p className="text-sm">Send a message to begin chatting with the AI</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <StreamingMessage
              key={message.id}
              content={message.content}
              role={message.role as 'user' | 'assistant'}
              inputTokens={message.inputTokens}
              outputTokens={message.outputTokens}
              isStreaming={
                message.role === 'assistant' &&
                streaming.isStreaming &&
                message.id === `msg-assistant-${Date.now()}`
              }
              error={message.role === 'assistant' ? streaming.error : undefined}
              completedAt={message.createdAt}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        {streaming.error && (
          <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {streaming.error}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="Type your message..."
            disabled={isLoading || streaming.isStreaming}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-white"
          />
          <Button
            onClick={handleSendMessage}
            disabled={isLoading || streaming.isStreaming || !inputValue.trim()}
            size="sm"
            className="flex items-center gap-2"
          >
            {isLoading || streaming.isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
