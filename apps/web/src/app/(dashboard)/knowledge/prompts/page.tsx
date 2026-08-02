'use client';

import { useState } from 'react';
import { Loader2, Plus, Search, Star, Trash2, Copy } from 'lucide-react';
import {
  usePrompts,
  useDeletePrompt,
  useTogglePromptFavorite,
  type Prompt,
} from '@/lib/api/prompts';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { CreatePromptDialog } from '@/components/library/CreatePromptDialog';
import { PROMPT_CATEGORIES } from '@/components/library/categories';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';

export default function PromptsPage() {
  // Knowledge pages are workspace-scoped but not workspace-routed: the
  // path is /knowledge/prompts, so there is no workspaceId URL param to
  // read. The active workspace is the scope.
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const {
    data: prompts = [],
    isLoading,
    error,
  } = usePrompts(workspaceId, { category: category || undefined });
  const deleteMutation = useDeletePrompt(workspaceId);
  const favoriteMutation = useTogglePromptFavorite(workspaceId);

  const filteredPrompts = prompts.filter((prompt) => {
    const needle = search.toLowerCase();
    return (
      prompt.name.toLowerCase().includes(needle) ||
      prompt.description?.toLowerCase().includes(needle) ||
      prompt.content.toLowerCase().includes(needle)
    );
  });

  const handleDelete = async (promptId: string) => {
    if (!window.confirm('Delete this prompt? This cannot be undone.')) return;
    try {
      await deleteMutation.mutateAsync(promptId);
      toast.success('Prompt deleted');
    } catch {
      toast.error('Failed to delete prompt');
    }
  };

  const handleToggleFavorite = async (promptId: string) => {
    try {
      await favoriteMutation.mutateAsync(promptId);
      toast.success('Favorite updated');
    } catch {
      toast.error('Failed to update favorite');
    }
  };

  const handleCopy = (prompt: Prompt) => {
    navigator.clipboard.writeText(prompt.content);
    toast.success('Prompt copied to clipboard');
  };

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">Failed to load prompts</p>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <CreatePromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />

      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-3xl font-bold">Prompt Library</h1>
            <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Prompt
            </Button>
          </div>
          <p className="text-muted-foreground">
            Create, organize, and manage reusable prompts for your conversations.
          </p>
        </div>
      </div>

      <div className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-7xl gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" aria-hidden />
            <input
              type="text"
              aria-label="Search prompts"
              placeholder="Search prompts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-input bg-background px-4 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Categories</option>
            {PROMPT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPrompts.length === 0 ? (
            <div className="py-12 text-center">
              <p className="mb-4 text-muted-foreground">No prompts found</p>
              <Button onClick={() => setCreateOpen(true)}>Create your first prompt</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="rounded-lg border border-border bg-card p-6 transition-all hover:shadow-lg"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="truncate font-semibold">{prompt.name}</h3>
                      {prompt.category && (
                        <p className="mt-1 text-xs text-muted-foreground">{prompt.category}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={
                        prompt.isFavorite
                          ? `Unfavorite ${prompt.name}`
                          : `Favorite ${prompt.name}`
                      }
                      onClick={() => handleToggleFavorite(prompt.id)}
                      className="rounded-lg p-2 transition-colors hover:bg-accent"
                    >
                      <Star
                        className={
                          prompt.isFavorite
                            ? 'h-5 w-5 fill-yellow-400 text-yellow-400'
                            : 'h-5 w-5 text-muted-foreground'
                        }
                      />
                    </button>
                  </div>

                  {prompt.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                      {prompt.description}
                    </p>
                  )}

                  <p className="mb-4 line-clamp-3 rounded bg-muted p-3 text-sm">
                    {prompt.content}
                  </p>

                  <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex gap-3">
                      <span>Used {prompt.usageCount} times</span>
                      {prompt.rating > 0 && <span>★ {prompt.rating.toFixed(1)}</span>}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(prompt)}
                      className="flex-1 gap-2"
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Delete ${prompt.name}`}
                      onClick={() => handleDelete(prompt.id)}
                      disabled={deleteMutation.isPending}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
