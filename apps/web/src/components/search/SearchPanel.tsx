'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useUnifiedSearch } from '@/lib/api/search';
import { Input } from '@synora/design-system/components/Input';
import { Spinner } from '@synora/design-system/components/Spinner';
import { SearchIcon, MessageSquare, FileText, X } from 'lucide-react';
import { cn } from '@synora/design-system/lib/cn';
import type { SearchResult } from '@/lib/api/search';

interface SearchPanelProps {
  onClose?: () => void;
  className?: string;
}

export function SearchPanel({ onClose, className }: SearchPanelProps) {
  const router = useRouter();
  const { currentWorkspace } = useCurrentWorkspace();
  const [query, setQuery] = useState('');
  const workspaceId = currentWorkspace?.id || '';

  const {
    data: results,
    isLoading,
    error,
  } = useUnifiedSearch(workspaceId, query, {
    enabled: !!workspaceId,
    take: 10,
  });

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      if (result.type === 'conversation') {
        router.push(`/conversations/${result.id}`);
      } else if (result.type === 'message' && result.conversationId) {
        router.push(`/conversations/${result.conversationId}?messageId=${result.id}`);
      }
      onClose?.();
    },
    [router, onClose]
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search conversations and messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        {query && (
          <button
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="sm" />
        </div>
      ) : error ? (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <p>Failed to search</p>
          {error instanceof Error && <p className="text-xs opacity-75">{error.message}</p>}
        </div>
      ) : query.trim() === '' ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <SearchIcon className="h-8 w-8 opacity-50" />
          <p>Enter a search term to find conversations and messages</p>
        </div>
      ) : results?.items && results.items.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">
            Found {results.total} result{results.total !== 1 ? 's' : ''}
          </div>
          <div className="space-y-1">
            {results.items.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => handleSelectResult(result)}
                className="flex w-full gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <div className="mt-1 flex-shrink-0">
                  {result.type === 'conversation' ? (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {result.title && (
                    <div className="font-medium text-sm line-clamp-1">
                      {result.title}
                    </div>
                  )}
                  {result.snippet && (
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {result.snippet}
                    </div>
                  )}
                  {result.type === 'message' && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      In conversation: {result.conversationId?.slice(0, 8)}...
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(result.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {results.hasMore && (
            <button className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent">
              Show more results
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <SearchIcon className="h-8 w-8 opacity-50" />
          <p>No results found for "{query}"</p>
        </div>
      )}
    </div>
  );
}
