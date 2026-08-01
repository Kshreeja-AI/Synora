'use client';

import { useCallback } from 'react';
import { usePresence } from '@/lib/api/collaboration';
import { useInputTyping } from './useInputTyping';

interface CollaborativeEditorProps {
  conversationId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function CollaborativeEditor({
  conversationId,
  value,
  onChange,
  placeholder = 'Type your message...',
  className = '',
}: CollaborativeEditorProps) {
  const { users, broadcastTyping } = usePresence(conversationId);
  const { handleInputChange } = useInputTyping({
    broadcastTyping,
  });

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      handleInputChange();
    },
    [onChange, handleInputChange]
  );

  const typingUsers = users.filter((u) => u.isTyping);

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none ${className}`}
      />

      {typingUsers.length > 0 && (
        <div className="text-xs text-muted-foreground px-3">
          <div className="flex gap-1 mb-1">
            {typingUsers.map((user) => (
              <span
                key={user.id}
                className="inline-block px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
              >
                {user.name}
              </span>
            ))}
          </div>
          <span>
            {typingUsers.length === 1 ? 'is' : 'are'} editing...
          </span>
        </div>
      )}
    </div>
  );
}
