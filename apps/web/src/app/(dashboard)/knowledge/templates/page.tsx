'use client';

import { useState } from 'react';
import { Loader2, Plus, Search, Zap, Trash2 } from 'lucide-react';
import {
  useWorkspaceTemplates,
  useDeleteTemplate,
  TEMPLATE_CATEGORIES,
} from '@/lib/api/templates';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useStartFromTemplate } from '@/hooks/useStartFromTemplate';
import { CreateTemplateDialog } from '@/components/library/CreateTemplateDialog';
import { Button } from '@synora/design-system';
import { Spinner } from '@synora/design-system/components/Spinner';
import { toast } from 'sonner';

export default function TemplatesPage() {
  // Same scoping rule as the prompts page: /knowledge/templates has no
  // workspaceId param, so the active workspace is the scope.
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: templates = [], isLoading, error } = useWorkspaceTemplates(workspaceId);
  const deleteMutation = useDeleteTemplate(workspaceId);
  const { start, startingId, error: startError } = useStartFromTemplate(workspaceId);

  const filteredTemplates = templates.filter((template) => {
    const needle = search.toLowerCase();
    const matchesSearch =
      template.title.toLowerCase().includes(needle) ||
      template.description?.toLowerCase().includes(needle);
    const matchesCategory = !category || template.category === category;
    return matchesSearch && matchesCategory;
  });

  const handleDelete = async (templateId: string) => {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    try {
      await deleteMutation.mutateAsync(templateId);
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">Failed to load templates</p>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />

      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-3xl font-bold">Conversation Templates</h1>
            <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Template
            </Button>
          </div>
          <p className="text-muted-foreground">
            Start conversations faster with pre-configured templates and system prompts.
          </p>
          {startError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {startError}
            </p>
          )}
        </div>
      </div>

      <div className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-7xl gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" aria-hidden />
            <input
              type="text"
              aria-label="Search templates"
              placeholder="Search templates..."
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
            {TEMPLATE_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
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
          ) : filteredTemplates.length === 0 ? (
            <div className="py-12 text-center">
              <p className="mb-4 text-muted-foreground">No templates found</p>
              <Button onClick={() => setCreateOpen(true)}>Create your first template</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex flex-col rounded-lg border border-border bg-card p-6 transition-all hover:shadow-lg"
                >
                  <div className="mb-3">
                    <h3 className="truncate font-semibold">{template.title}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded bg-muted px-2 py-1 text-xs">
                        {TEMPLATE_CATEGORIES.find((c) => c.value === template.category)?.label ||
                          template.category}
                      </span>
                      {template.isPublic && (
                        <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                          Public
                        </span>
                      )}
                    </div>
                  </div>

                  {template.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  )}

                  <div className="flex-1">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">
                      System Prompt
                    </p>
                    <p className="mb-3 line-clamp-3 rounded bg-muted p-3 font-mono text-xs">
                      {template.systemPrompt}
                    </p>
                  </div>

                  {template.suggestedFollowUps && template.suggestedFollowUps.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">
                        Suggested Follow-ups
                      </p>
                      <div className="space-y-1">
                        {template.suggestedFollowUps.slice(0, 2).map((followUp, idx) => (
                          <p key={idx} className="text-xs text-muted-foreground">
                            • {followUp}
                          </p>
                        ))}
                        {template.suggestedFollowUps.length > 2 && (
                          <p className="text-xs text-muted-foreground">
                            +{template.suggestedFollowUps.length - 2} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1 gap-2"
                      disabled={startingId !== null}
                      onClick={() => start(template)}
                    >
                      {startingId === template.id ? (
                        <>
                          <Spinner size="sm" />
                          Starting…
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4" />
                          Use Template
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Delete ${template.title}`}
                      onClick={() => handleDelete(template.id)}
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
