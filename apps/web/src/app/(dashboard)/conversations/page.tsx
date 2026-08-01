'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useConversations,
  useCreateConversation,
} from '@/lib/api/conversations';
import { api } from '@/lib/api/client';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { AlertCircle, Plus, Trash2, Archive } from 'lucide-react';

export default function ConversationsPage() {
  const router = useRouter();
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const {
    data: conversationsData,
    isLoading,
    error: fetchError,
  } = useConversations(workspaceId, { enabled: !!workspaceId });

  const createMutation = useCreateConversation(workspaceId);

  const conversations = conversationsData?.items || [];
  const error = fetchError || createMutation.error;

  const handleCreateConversation = async () => {
    try {
      const conversation = await createMutation.mutateAsync({
        title: 'New Conversation',
        provider: 'anthropic',
        model: 'claude-opus',
      });

      if (conversation?.id) {
        router.push(`/conversations/${conversation.id}`);
      }
    } catch (err) {
      console.error('Failed to create conversation', err);
    }
  };

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this conversation?')) {
      return;
    }

    try {
      await api.delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}`);
      // Invalidate the query to refetch the list
      window.location.reload();
    } catch (err) {
      console.error('Failed to delete conversation', err);
    }
  };

  const handleArchiveConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await api.patch(`/api/workspaces/${workspaceId}/conversations/${conversationId}`, {
        isArchived: true,
      });
      // Invalidate the query to refetch the list
      window.location.reload();
    } catch (err) {
      console.error('Failed to archive conversation', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conversations</h1>
            <p className="text-sm text-muted-foreground mt-1">Chat with AI across multiple conversations</p>
          </div>
          <Button onClick={handleCreateConversation} className="gap-2" disabled={createMutation.isPending}>
            <Plus className="h-4 w-4" />
            {createMutation.isPending ? 'Creating...' : 'New Conversation'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-sm text-red-800">{error instanceof Error ? error.message : 'An error occurred'}</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Spinner />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Plus className="h-12 w-12 text-muted-foreground opacity-50 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No conversations yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Get started by creating your first conversation to chat with AI
            </p>
            <Button onClick={handleCreateConversation} className="gap-2" disabled={createMutation.isPending}>
              <Plus className="h-4 w-4" />
              Create Conversation
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => (
              <Link key={conversation.id} href={`/conversations/${conversation.id}`} className="block">
                <div className="group p-4 rounded-lg border border-border bg-card hover:bg-accent transition-colors cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                        {conversation.title}
                      </h3>
                      {conversation.description && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">{conversation.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                        <span className="px-2 py-1 bg-muted rounded text-foreground font-medium">
                          {conversation.provider}
                        </span>
                        <span className="px-2 py-1 bg-muted rounded text-foreground font-medium">{conversation.model}</span>
                        <span>{new Date(conversation.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleArchiveConversation(conversation.id, e)}
                        className="p-2 hover:bg-muted rounded-md transition-colors"
                        title="Archive conversation"
                      >
                        <Archive className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteConversation(conversation.id, e)}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                        title="Delete conversation"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
