'use client';

import { useMemo, useState } from 'react';
import { Loader2, Pin, PinOff, Search, Sparkles, Trash2, Plus, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@synora/design-system';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useMemoryStats,
  usePinMemory,
  useUnpinMemory,
  useUpdateMemory,
} from '@/hooks/useMemories';
import type { Memory, MemoryType } from '@/lib/api/memories';

/**
 * Memory management surface. The RAG path (generateResponse worker →
 * conversationContextService) reads exactly the rows shown here — pinning,
 * editing, and deleting on this page directly changes what future replies see.
 */

const TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: 'SEMANTIC', label: 'Semantic (facts)' },
  { value: 'EPISODIC', label: 'Episodic (events)' },
  { value: 'PROCEDURAL', label: 'Procedural (how)' },
  { value: 'PREFERENCE', label: 'Preference' },
  { value: 'FACT', label: 'Fact' },
  { value: 'CONTEXT', label: 'Context' },
  { value: 'SHORT_TERM', label: 'Short-term' },
  { value: 'LONG_TERM', label: 'Long-term' },
];

function importanceLabel(v: number) {
  if (v >= 0.75) return 'High';
  if (v >= 0.4) return 'Medium';
  return 'Low';
}

function MemoryCard({ workspaceId, memory }: { workspaceId: string; memory: Memory }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  const pinMutation = usePinMemory(workspaceId);
  const unpinMutation = useUnpinMemory(workspaceId);
  const deleteMutation = useDeleteMemory(workspaceId);
  const updateMutation = useUpdateMemory(workspaceId);

  const togglePin = () => {
    const mutation = memory.isPinned ? unpinMutation : pinMutation;
    mutation.mutate(memory.id, {
      onError: (err) => toast.error(err.message || 'Failed to change pin state'),
      onSuccess: () =>
        toast.success(memory.isPinned ? 'Memory unpinned' : 'Memory pinned'),
    });
  };

  const onDelete = () => {
    if (!confirm('Delete this memory? The AI will no longer use it in replies.')) return;
    deleteMutation.mutate(memory.id, {
      onError: (err) => toast.error(err.message || 'Failed to delete memory'),
      onSuccess: () => toast.success('Memory deleted'),
    });
  };

  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === memory.content) {
      setEditing(false);
      return;
    }
    updateMutation.mutate(
      { memoryId: memory.id, patch: { content: trimmed } },
      {
        onError: (err) => toast.error(err.message || 'Failed to update memory'),
        onSuccess: () => {
          toast.success('Memory updated');
          setEditing(false);
        },
      }
    );
  };

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
            {memory.type}
          </span>
          {memory.category ? (
            <span className="rounded bg-muted px-1.5 py-0.5">{memory.category}</span>
          ) : null}
          <span title={`importance ${memory.importance.toFixed(2)}`}>
            Importance: {importanceLabel(memory.importance)}
          </span>
          {memory.isPinned ? (
            <span className="flex items-center gap-1 text-primary">
              <Pin className="h-3 w-3" /> Pinned
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={togglePin} aria-label={memory.isPinned ? 'Unpin' : 'Pin'}>
            {memory.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setDraft(memory.content); setEditing(false); }}>
              <X className="mr-1 h-3 w-3" /> Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={updateMutation.isPending}>
              <Save className="mr-1 h-3 w-3" /> Save
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 block w-full whitespace-pre-wrap text-left text-sm text-foreground hover:text-primary"
          aria-label="Edit memory"
        >
          {memory.content}
        </button>
      )}

      <footer className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span>Created {new Date(memory.createdAt).toLocaleDateString()}</span>
        {memory.accessCount != null ? <span>Used {memory.accessCount}×</span> : null}
      </footer>
    </article>
  );
}

function CreateMemoryDialog({
  workspaceId,
  open,
  onClose,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('SEMANTIC');
  const mutation = useCreateMemory(workspaceId);

  if (!open) return null;

  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    mutation.mutate(
      { content: trimmed, type },
      {
        onError: (err) => toast.error(err.message || 'Failed to create memory'),
        onSuccess: () => {
          toast.success('Memory added');
          setContent('');
          onClose();
        },
      }
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add a memory"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Add a memory</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The AI will use this in future replies in this workspace.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="mem-type">Type</label>
        <select
          id="mem-type"
          value={type}
          onChange={(e) => setType(e.target.value as MemoryType)}
          className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-medium" htmlFor="mem-content">Content</label>
        <textarea
          id="mem-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
          placeholder="What should the AI remember?"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={mutation.isPending || content.trim().length === 0}>
            {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Add memory
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MemoriesPage() {
  // Same workspace-scope pattern as prompts/templates: /knowledge/memories has
  // no workspaceId param; the active workspace is the scope.
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | MemoryType>('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const params = useMemo(
    () => ({
      search: search.trim() || undefined,
      type: (typeFilter || undefined) as MemoryType | undefined,
      pinnedOnly: pinnedOnly || undefined,
      limit: 100,
    }),
    [search, typeFilter, pinnedOnly]
  );

  const { data, isLoading, error } = useMemories(workspaceId, params);
  const stats = useMemoryStats(workspaceId);

  const memories = data?.memories ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Sparkles className="h-6 w-6 text-primary" /> Memories
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything the AI remembers about this workspace. Pin, edit, or delete —
            changes take effect on the next reply.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add memory
        </Button>
      </header>

      {stats.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-semibold">{stats.data.totalMemories}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Active</div>
            <div className="text-lg font-semibold">{stats.data.activeMemories}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Archived</div>
            <div className="text-lg font-semibold">{stats.data.archivedMemories}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Avg importance</div>
            <div className="text-lg font-semibold">{stats.data.averageImportance.toFixed(2)}</div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search memories"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories…"
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm"
          />
        </div>
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | MemoryType)}
          className="rounded-md border border-input bg-background px-2 py-2 text-sm"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={pinnedOnly}
            onChange={(e) => setPinnedOnly(e.target.checked)}
          />
          Pinned only
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading memories…
        </div>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load memories. Please retry.
        </div>
      ) : memories.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No memories yet. Add one manually, or keep chatting — the AI will save relevant
            context automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {memories.map((m) => (
            <MemoryCard key={m.id} workspaceId={workspaceId} memory={m} />
          ))}
        </div>
      )}

      <CreateMemoryDialog
        workspaceId={workspaceId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
