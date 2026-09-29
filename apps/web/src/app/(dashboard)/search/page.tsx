'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search as SearchIcon, MessagesSquare, FileText, Loader2, ArrowRight } from 'lucide-react';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useSearchConversations,
  useSearchMessages,
  type SearchResult,
} from '@/lib/api/search';

/**
 * Global search results.
 *
 * URL-driven: `?q=...` and `?type=conversations|messages` are the source of
 * truth so results are shareable and back/forward navigation preserves them
 * without extra state juggling. The topbar's search button now navigates here
 * too, making this the one full-fidelity view of the search subsystem.
 *
 * Deliberately not a fully-live search-as-you-type — that shape belongs in the
 * command palette (`useSearchDialog`), which is separate and open elsewhere.
 * This is the "hit Enter, land on a results page you can scroll and filter"
 * flow, which is different enough to warrant its own surface.
 */
function SearchPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { currentWorkspace, isLoading: workspaceLoading } = useCurrentWorkspace();

  const initialQ = params.get('q') ?? '';
  const initialType = (params.get('type') as 'conversations' | 'messages') || 'conversations';

  // Two pieces of state:
  //   `input` — what's in the search box, updated on every keystroke
  //   `q` (via URL) — what we actually query, committed on submit
  // Splitting them avoids a request on every keystroke while keeping URL
  // state as the search source of truth.
  const [input, setInput] = useState(initialQ);
  const [type, setType] = useState<'conversations' | 'messages'>(initialType);

  useEffect(() => {
    setInput(params.get('q') ?? '');
    setType((params.get('type') as 'conversations' | 'messages') || 'conversations');
  }, [params]);

  const workspaceId = currentWorkspace?.id ?? '';
  const query = initialQ;

  const conversationsResult = useSearchConversations(workspaceId, query, {
    take: 50,
    enabled: type === 'conversations' && !!query,
  });
  const messagesResult = useSearchMessages(workspaceId, query, {
    take: 50,
    enabled: type === 'messages' && !!query,
  });

  const activeResult = type === 'conversations' ? conversationsResult : messagesResult;
  const results: SearchResult[] = activeResult.data?.items ?? [];

  const submit = (nextInput: string, nextType: 'conversations' | 'messages' = type) => {
    const next = new URLSearchParams();
    if (nextInput.trim()) next.set('q', nextInput.trim());
    if (nextType !== 'conversations') next.set('type', nextType);
    router.replace(`/search${next.toString() ? `?${next.toString()}` : ''}`);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {currentWorkspace
            ? `Search ${currentWorkspace.name}`
            : workspaceLoading
            ? 'Loading workspace…'
            : 'Pick a workspace to search'}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        <div className="relative min-w-[240px] flex-1">
          <SearchIcon className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search query"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search conversations and messages…"
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm"
            autoFocus
          />
        </div>
        <div
          role="tablist"
          aria-label="Scope"
          className="inline-flex rounded-md border border-input p-0.5"
        >
          {(
            [
              { id: 'conversations', label: 'Conversations', icon: FileText },
              { id: 'messages', label: 'Messages', icon: MessagesSquare },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = type === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setType(opt.id);
                  submit(input, opt.id);
                }}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </form>

      {!query ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          Type a query above to search this workspace.
        </div>
      ) : activeResult.isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Searching…
        </div>
      ) : activeResult.error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not run the search.
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          No {type} matched <span className="font-medium text-foreground">{query}</span>.
        </div>
      ) : (
        <ol className="space-y-2" aria-label={`${type} results`}>
          {results.map((r) => (
            <SearchResultRow key={`${r.type}-${r.id}`} result={r} query={query} />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Highlight all case-insensitive matches of `query` within `text`.
 * Splits on the query so React handles escaping — never uses innerHTML.
 */
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const rx = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(rx);
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function SearchResultRow({ result, query }: { result: SearchResult; query: string }) {
  const href =
    result.type === 'message' && result.conversationId
      ? `/conversations/${result.conversationId}?highlight=${result.id}`
      : `/conversations/${result.id}`;
  const title = result.title || (result.type === 'message' ? 'Message' : 'Untitled conversation');
  const body = result.snippet || result.content || '';

  return (
    <li>
      <Link
        href={href}
        className="group block rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/60"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {result.type === 'message' ? (
                <MessagesSquare className="h-3 w-3 text-muted-foreground" aria-hidden />
              ) : (
                <FileText className="h-3 w-3 text-muted-foreground" aria-hidden />
              )}
              <span className="truncate text-sm font-medium">{highlight(title, query)}</span>
            </div>
            {body ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {highlight(body, query)}
              </p>
            ) : null}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{new Date(result.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>relevance {(result.relevance ?? 0).toFixed(2)}</span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </Link>
    </li>
  );
}

export default function SearchPage() {
  // useSearchParams requires a Suspense boundary — Next.js renders the page
  // shell first, then hydrates the URL-driven content, avoiding a flash of
  // "no query" on direct navigations.
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading search…
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}
