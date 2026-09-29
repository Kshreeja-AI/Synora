'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MessageSquare, Loader2, X } from 'lucide-react';
import { useSearchConversations, useSearchMessages } from '@/lib/api/search';
import type { SearchResult } from '@/lib/api/search';

interface SearchDialogProps {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SearchDialog({
  workspaceId,
  isOpen,
  onClose,
}: SearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'conversations' | 'messages'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const conversationsSearch = useSearchConversations(workspaceId, query, {
    enabled: isOpen && activeTab !== 'messages',
  });

  const messagesSearch = useSearchMessages(workspaceId, query, {
    enabled: isOpen && activeTab !== 'conversations',
  });

  const results: SearchResult[] = (() => {
    if (activeTab === 'conversations') return conversationsSearch.data?.items || [];
    if (activeTab === 'messages') return messagesSearch.data?.items || [];

    // Combine and sort by relevance
    const all = [
      ...(conversationsSearch.data?.items || []),
      ...(messagesSearch.data?.items || []),
    ].sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    return all.slice(0, 20);
  })();

  const isLoading = conversationsSearch.isLoading || messagesSearch.isLoading;

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.type === 'conversation') {
        router.push(`/conversations/${result.id}`);
      } else {
        router.push(`/conversations/${result.conversationId}`);
      }
      onClose();
    },
    [router, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, selectedIndex, handleSelect, onClose]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Close dialog on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-16 transition-opacity"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-2xl rounded-lg border border-border shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="border-b border-border p-4 flex items-center gap-3">
          <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder="Search conversations, messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1 bg-transparent text-foreground outline-none text-sm"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
              }}
              className="p-1 hover:bg-accent rounded transition"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Tabs */}
        {query && (
          <div className="border-b border-border flex gap-0 px-4">
            {['all', 'conversations', 'messages'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                  activeTab === tab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {!query ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <p>Start typing to search conversations and messages</p>
              <p className="text-xs mt-2">Press Ctrl+K to focus search</p>
            </div>
          ) : isLoading ? (
            <div className="p-8 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Searching...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          ) : (
            <div className="divide-y divide-border">
              {results.map((result, index) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleSelect(result)}
                  className={`w-full text-left p-4 transition ${
                    index === selectedIndex
                      ? 'bg-accent'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0">
                      {result.type === 'conversation' ? (
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground truncate">
                        {result.title || result.content?.substring(0, 60) || 'Untitled'}
                      </div>
                      {result.snippet && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {result.snippet}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {result.type === 'conversation' ? 'Conversation' : 'Message'}
                        {result.createdAt && ` • ${new Date(result.createdAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    {result.relevance && (
                      <div className="flex-shrink-0 text-xs text-muted-foreground">
                        {Math.round(result.relevance * 100)}%
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="border-t border-border p-2 flex items-center justify-between text-xs text-muted-foreground">
            <div>
              {results.length} result{results.length !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-2">
              <span className="px-2 py-1 bg-muted rounded">↑↓</span>
              <span className="px-2 py-1 bg-muted rounded">Enter</span>
              <span className="px-2 py-1 bg-muted rounded">Esc</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
