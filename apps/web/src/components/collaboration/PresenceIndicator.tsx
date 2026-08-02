'use client';

/**
 * "Who else is here" avatars for a conversation. Presence events
 * carry only userIds — names and avatars come from the workspace
 * member list, which every viewer of the conversation is entitled to
 * see. The current user is filtered out (you know you're here).
 */

import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useConversationPresence } from '@/lib/api/collaboration';
import { listWorkspaceMembers } from '@/lib/api/workspaces';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface PresenceIndicatorProps {
  workspaceId: string;
  conversationId: string;
  maxAvatars?: number;
}

export function PresenceIndicator({
  workspaceId,
  conversationId,
  maxAvatars = 5,
}: PresenceIndicatorProps) {
  const { participants } = useConversationPresence(conversationId);
  const { data: currentUser } = useCurrentUser();
  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => listWorkspaceMembers(workspaceId),
    enabled: !!workspaceId && participants.length > 0,
    staleTime: 60_000,
  });

  const others = participants.filter((p) => p.userId !== currentUser?.id);
  if (others.length === 0) return null;

  const profileOf = (userId: string) => {
    const member = members.find((m) => m.user.id === userId);
    return {
      name: member?.user.name || member?.user.email || 'Member',
      image: member?.user.image ?? null,
    };
  };

  const displayed = others.slice(0, maxAvatars);
  const moreCount = others.length - displayed.length;

  return (
    <div className="flex items-center gap-2" aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} viewing`}>
      <div className="flex items-center -space-x-2">
        {displayed.map((participant) => {
          const profile = profileOf(participant.userId);
          return (
            <div
              key={participant.userId}
              title={profile.name}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground"
            >
              {profile.image ? (
                <img
                  src={profile.image}
                  alt={profile.name}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <span>{profile.name.charAt(0).toUpperCase()}</span>
              )}
              {participant.isTyping && (
                <span
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-blue-500"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
        {moreCount > 0 && (
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground">
            +{moreCount}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden />
        {others.length === 1 ? '1 viewing' : `${others.length} viewing`}
      </div>
    </div>
  );
}
