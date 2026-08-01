'use client';

import { useTypingIndicator } from '@/lib/api/collaboration';

interface TypingIndicatorProps {
  conversationId: string;
}

export function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const { typingUsers } = useTypingIndicator(conversationId, false);

  if (typingUsers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground">
      <div className="flex gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground animate-bounce" />
        <span
          className="inline-block h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: '0.1s' }}
        />
        <span
          className="inline-block h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: '0.2s' }}
        />
      </div>
      <span>
        {typingUsers.length === 1
          ? `${typingUsers[0].name} is typing`
          : `${typingUsers.map((u) => u.name).join(', ')} are typing`}
      </span>
    </div>
  );
}
