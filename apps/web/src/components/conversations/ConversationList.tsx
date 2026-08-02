'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConversations } from '@/lib/api/conversations';
import { Conversation } from '@/lib/types/conversations';
import { Spinner } from '@synora/design-system/components/Spinner';
import { MessageSquare, Plus } from 'lucide-react';
import { CreateConversationDialog } from './CreateConversationDialog';
import { ConversationCard } from './ConversationCard';

interface ConversationListProps {
  workspaceId: string;
  archived?: boolean;
}

export function ConversationList({
  workspaceId,
  archived = false,
}: ConversationListProps) {
  const router = useRouter();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useConversations(workspaceId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-destructive/10 p-4 text-destructive">
        <p className="font-medium">Failed to load conversations</p>
        <p className="text-sm opacity-75">Please try again later</p>
      </div>
    );
  }

  const conversations = data?.pages.flatMap((page) => page.items) ?? [];

  if (conversations.length === 0) {
    return (
      <div className="rounded-lg border border-border border-dashed p-8 text-center">
        <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
        <h3 className="font-medium text-foreground mb-1">
          {archived ? 'No archived conversations' : 'No conversations yet'}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {archived
            ? 'Archived conversations will appear here'
            : 'Start a new conversation to get going'}
        </p>
        {!archived && (
          <button
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" />
            New Conversation
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {!archived && (
          <button
            onClick={() => setShowCreateDialog(true)}
            className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Conversation
          </button>
        )}

        {conversations.map((conversation: Conversation) => (
          <ConversationCard
            key={conversation.id}
            conversation={conversation}
            workspaceId={workspaceId}
            onClick={() =>
              router.push(`/conversations/${conversation.id}`)
            }
          />
        ))}

        {hasNextPage && (
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load More'}
          </button>
        )}
      </div>

      <CreateConversationDialog
        workspaceId={workspaceId}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </>
  );
}
