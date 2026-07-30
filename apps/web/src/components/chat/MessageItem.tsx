'use client';

import { Message } from '@/lib/types/conversations';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageItem({ message, isStreaming }: MessageItemProps) {
  const isAssistant = message.role === 'ASSISTANT';
  const isUser = message.role === 'USER';

  // Simple markdown-like formatting (basic implementation)
  const renderContent = (content: string) => {
    // Handle code blocks
    const parts = content.split(/```([\s\S]*?)```/);
    return (
      <>
        {parts.map((part, idx) => {
          if (idx % 2 === 0) {
            // Regular text
            return (
              <p key={idx} className="whitespace-pre-wrap">
                {part}
              </p>
            );
          } else {
            // Code block
            return (
              <pre
                key={idx}
                className="bg-slate-900 dark:bg-slate-800 text-slate-100 p-4 rounded-lg overflow-x-auto my-2"
              >
                <code>{part}</code>
              </pre>
            );
          }
        })}
      </>
    );
  };

  return (
    <div
      className={`flex gap-4 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
      data-testid="message"
    >
      <div
        className={`flex gap-3 max-w-2xl ${
          isUser ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            isAssistant
              ? 'bg-blue-600 text-white'
              : isUser
              ? 'bg-slate-400 text-white'
              : 'bg-slate-600 text-white'
          }`}
        >
          {isAssistant ? '⚡' : isUser ? 'You' : '⚙'}
        </div>

        {/* Content */}
        <div
          className={`px-4 py-3 rounded-lg ${
            isUser
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
          }`}
        >
          <div className="text-sm leading-relaxed">
            {renderContent(message.content)}
          </div>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-current ml-1 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
