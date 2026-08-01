'use client';

import { useState } from 'react';
import { useArchiveConversation, useDeleteConversation } from '@/lib/api/conversations';
import { Conversation } from '@/lib/types/conversations';
import { MessageSquare, Archive, Trash2, MoreVertical } from 'lucide-react';

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  return `${Math.floor(seconds / 2592000)}mo ago`;
}

interface ConversationCardProps {
  conversation: Conversation;
  workspaceId: string;
  onClick?: () => void;
}

export function ConversationCard({
  conversation,
  workspaceId,
  onClick,
}: ConversationCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const { mutate: archive, isPending: isArchiving } =
    useArchiveConversation(workspaceId, conversation.id);
  const { mutate: deleteConv, isPending: isDeleting } =
    useDeleteConversation(workspaceId, conversation.id);

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    archive();
    setShowMenu(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this conversation? This action cannot be undone.')) {
      deleteConv();
      setShowMenu(false);
    }
  };

  const isLoading = isArchiving || isDeleting;
  const lastMessageTime = conversation.lastMessageAt
    ? formatRelativeTime(new Date(conversation.lastMessageAt))
    : null;

  return (
    <div
      onClick={onClick}
      className="group relative rounded-lg border border-border bg-card p-3 hover:bg-accent cursor-pointer transition"
    >
      <div className="flex items-start gap-3">
        <MessageSquare className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">
            {conversation.title || 'Untitled Conversation'}
          </h3>
          {conversation.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {conversation.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {lastMessageTime || 'Never'}
          </p>
        </div>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            disabled={isLoading}
            className="opacity-0 group-hover:opacity-100 rounded p-1 hover:bg-muted transition disabled:opacity-50"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-border bg-popover shadow-md">
              <button
                onClick={handleArchive}
                disabled={isLoading}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50 transition first:rounded-t-lg"
              >
                <Archive className="h-4 w-4" />
                Archive
              </button>
              <button
                onClick={handleDelete}
                disabled={isLoading}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50 transition last:rounded-b-lg"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
