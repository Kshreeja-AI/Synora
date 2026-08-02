'use client';

/**
 * "Someone is typing…" strip shown above the composer. Names resolve
 * through the workspace member list; the current user is excluded
 * (their own typing is broadcast, not displayed back to them).
 */

import { useQuery } from '@tanstack/react-query';
import { useConversationPresence } from '@/lib/api/collaboration';
import { listWorkspaceMembers } from '@/lib/api/workspaces';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface TypingIndicatorProps {
  workspaceId: string;
  conversationId: string;
}

export function TypingIndicator({ workspaceId, conversationId }: TypingIndicatorProps) {
  const { participants } = useConversationPresence(conversationId);
  const { data: currentUser } = useCurrentUser();

  const typing = participants.filter((p) => p.isTyping && p.userId !== currentUser?.id);

  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => listWorkspaceMembers(workspaceId),
    enabled: !!workspaceId && typing.length > 0,
    staleTime: 60_000,
  });

  if (typing.length === 0) return null;

  const nameOf = (userId: string) => {
    const member = members.find((m) => m.user.id === userId);
    return member?.user.name || member?.user.email || 'Someone';
  };

  const names = typing.map((p) => nameOf(p.userId));

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
    >
      <div className="flex gap-1" aria-hidden>
        <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
        <span
          className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: '0.1s' }}
        />
        <span
          className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: '0.2s' }}
        />
      </div>
      <span>
        {names.length === 1 ? `${names[0]} is typing` : `${names.join(', ')} are typing`}
      </span>
    </div>
  );
}
