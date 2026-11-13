'use client';

import Link from 'next/link';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { Skeleton } from '@synora/design-system';
import { useConversations } from '@/lib/api/conversations';

function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The five most recently touched conversations in this workspace — a way
 * back into what you were doing. Every row is a real conversation from the
 * API; when the request fails the panel says so instead of showing nothing.
 */
export function RecentConversations({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { data, isLoading, isError } = useConversations(workspaceId, { enabled: !!workspaceId });
  const conversations = (data?.pages.flatMap((page) => page.conversations) ?? []).slice(0, 5);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      aria-labelledby="recent-conversations-heading"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="recent-conversations-heading" className="text-sm font-semibold">
          Recent conversations
        </h2>
        <Link
          href="/conversations"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View all <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : isError ? (
        <p role="status" className="text-sm text-muted-foreground">
          Conversations could not be loaded right now.
        </p>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conversations yet.{' '}
          <Link href="/conversations" className="font-medium text-primary hover:underline">
            Start one
          </Link>
          .
        </p>
      ) : (
        <ul className="-mx-2">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/conversations/${conversation.id}`}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent"
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{conversation.title || 'Untitled conversation'}</span>
                <time
                  dateTime={conversation.lastMessageAt ?? conversation.updatedAt}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {when(conversation.lastMessageAt ?? conversation.updatedAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
