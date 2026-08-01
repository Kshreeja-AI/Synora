'use client';

import { usePresence } from '@/lib/api/collaboration';
import { Users } from 'lucide-react';

interface PresenceIndicatorProps {
  conversationId: string;
  maxAvatars?: number;
}

export function PresenceIndicator({
  conversationId,
  maxAvatars = 5,
}: PresenceIndicatorProps) {
  const { users } = usePresence(conversationId);

  if (users.length === 0) {
    return null;
  }

  const displayedUsers = users.slice(0, maxAvatars);
  const moreCount = users.length - maxAvatars;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center -space-x-2">
        {displayedUsers.map((user) => (
          <div
            key={user.id}
            title={user.name}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground"
          >
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <span>{user.name.charAt(0).toUpperCase()}</span>
            )}
            {user.isTyping && (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-blue-500" />
            )}
          </div>
        ))}
        {moreCount > 0 && (
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground">
            +{moreCount}
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Users className="h-3.5 w-3.5" />
        {users.length === 1 ? '1 viewing' : `${users.length} viewing`}
      </div>
    </div>
  );
}
