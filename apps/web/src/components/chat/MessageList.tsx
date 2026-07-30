'use client';

import { useEffect, useRef } from 'react';
import { Message } from '@/lib/types/conversations';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  streamContent: string;
  onLoadMore: () => void;
  hasMore: boolean;
}

export function MessageList({
  messages,
  isLoading,
  isStreaming,
  streamContent,
  onLoadMore,
  hasMore,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  // Handle infinite scroll (load older messages)
  useEffect(() => {
    const handleScroll = () => {
      if (!listRef.current) return;
      const { scrollTop } = listRef.current;
      if (scrollTop === 0 && hasMore && !isLoading) {
        onLoadMore();
      }
    };

    const element = listRef.current;
    element?.addEventListener('scroll', handleScroll);
    return () => element?.removeEventListener('scroll', handleScroll);
  }, [hasMore, isLoading, onLoadMore]);

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
    >
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="text-slate-500 dark:text-slate-400">Loading messages...</div>
        </div>
      )}

      {messages.length === 0 && !isLoading && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-slate-500 dark:text-slate-400">
            <p className="mb-2">No messages yet</p>
            <p className="text-sm">Start by typing a message below</p>
          </div>
        </div>
      )}

      {/* Message items */}
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}

      {/* Streaming message */}
      {isStreaming && streamContent && (
        <MessageItem
          message={{
            id: 'streaming',
            conversationId: messages[0]?.conversationId || '',
            content: streamContent,
            role: 'ASSISTANT',
            createdAt: new Date(),
            updatedAt: new Date(),
          }}
          isStreaming
        />
      )}

      {/* Typing indicator */}
      {isStreaming && !streamContent && (
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <span>Assistant is typing</span>
          <span className="flex gap-1">
            <span className="w-2 h-2 bg-current rounded-full animate-bounce" />
            <span className="w-2 h-2 bg-current rounded-full animate-bounce delay-100" />
            <span className="w-2 h-2 bg-current rounded-full animate-bounce delay-200" />
          </span>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={endRef} />
    </div>
  );
}
