'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useConversations, useCreateConversation } from '@/lib/api/conversations';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { MessageSquare, Plus, Search } from 'lucide-react';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Persistent conversation rail. Rendered by the conversations layout so it
 * survives navigation between chats — the list keeps its scroll position and
 * the active chat's streaming state is never remounted.
 */
export function ConversationSidebar() {
  const router = useRouter();
  const params = useParams();
  const activeId = params?.id as string | undefined;
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [query, setQuery] = useState('');

  const { data, isLoading } = useConversations(workspaceId, { enabled: !!workspaceId });
  const createMutation = useCreateConversation(workspaceId);

  const conversations = useMemo(() => {
    const items = data?.items ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((c) => c.title.toLowerCase().includes(needle));
  }, [data, query]);

  const handleCreate = () => {
    createMutation.mutate(
      { title: 'New Conversation', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL },
      {
        onSuccess: (conversation) => {
          if (conversation?.id) router.push(`/conversations/${conversation.id}`);
        },
      }
    );
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="space-y-3 border-b border-border p-3">
        <Button
          onClick={handleCreate}
          disabled={!workspaceId || createMutation.isPending}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          {createMutation.isPending ? 'Creating…' : 'New Chat'}
        </Button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Conversations">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {query ? 'No chats match your search.' : 'No conversations yet.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeId;
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/conversations/${conversation.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <span className="truncate">{conversation.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
