'use client';

import { useState } from 'react';
import { useConversations } from '@/lib/api/conversations';

interface ConversationSidebarProps {
  workspaceId: string;
  onCreateConversation: () => void;
  onSelectConversation: (id: string) => void;
}

export function ConversationSidebar({
  workspaceId,
  onCreateConversation,
  onSelectConversation,
}: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const conversationsQuery = useConversations(workspaceId);

  // Get all conversations from all pages
  const allConversations = conversationsQuery.data?.pages.flatMap((p: any) => p.items) || [];

  // Filter conversations by search
  const filteredConversations = allConversations.filter(
    (conv: any) =>
      conv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={onCreateConversation}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
        >
          + New Conversation
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto">
        {conversationsQuery.isLoading && (
          <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            Loading conversations...
          </div>
        )}

        {filteredConversations.length === 0 && !conversationsQuery.isLoading && (
          <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            {searchQuery ? 'No conversations found' : 'No conversations yet'}
          </div>
        )}

        <div className="space-y-1 px-2 py-2">
          {filteredConversations.map((conversation: any) => (
            <button
              key={conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition group"
            >
              <div className="font-medium text-slate-900 dark:text-white text-sm truncate">
                {conversation.title}
              </div>
              {conversation.description && (
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {conversation.description}
                </div>
              )}
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                {conversation.lastMessageAt
                  ? new Date(conversation.lastMessageAt).toLocaleDateString()
                  : 'No messages'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Load more */}
      {conversationsQuery.hasNextPage && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => conversationsQuery.fetchNextPage()}
            disabled={conversationsQuery.isFetchingNextPage}
            className="w-full text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50 font-medium"
          >
            {conversationsQuery.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
