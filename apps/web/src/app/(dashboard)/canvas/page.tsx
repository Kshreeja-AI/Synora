'use client';

import { useState } from 'react';
import { Archive, LayoutGrid, Loader2, Plus, StickyNote, Trash2 } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useAddBlock,
  useArchiveCanvas,
  useCanvas,
  useCanvases,
  useCreateCanvas,
  useRemoveBlock,
  useUpdateBlock,
  type BlockKind,
  type CanvasBlock,
} from '@/lib/api/canvas';

/**
 * A spatial surface for arranging work.
 *
 * MOVEMENT IS BY NUDGE, NOT DRAG, and that is a deliberate first version.
 * Drag-and-drop is what people expect and it is substantially more code —
 * pointer capture, scroll interaction, touch, accessibility. Until someone
 * has actually arranged a few canvases, I do not know whether the spatial
 * model is even the right one, and building the elaborate interaction
 * first would be committing to a design I cannot yet justify. Nudge
 * buttons are also keyboard-reachable by default, which drag is not
 * without extra work.
 */

const GRID = 20;

const BLOCK_STYLES: Record<BlockKind, string> = {
  text: 'bg-background',
  note: 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800',
  link: 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800',
};

export default function CanvasPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const { data: canvases = [], isLoading } = useCanvases(workspaceId);
  const { data: canvas } = useCanvas(workspaceId, selectedId ?? '', { enabled: !!selectedId });
  const create = useCreateCanvas(workspaceId);
  const archive = useArchiveCanvas(workspaceId);
  const addBlock = useAddBlock(workspaceId);
  const updateBlock = useUpdateBlock(workspaceId);
  const removeBlock = useRemoveBlock(workspaceId);

  function add(kind: BlockKind) {
    if (!selectedId) return;
    const count = canvas?.blocks.length ?? 0;
    addBlock.mutate(
      {
        canvasId: selectedId,
        input: {
          kind,
          content: kind === 'note' ? 'New note' : 'New text',
          // Staggered so a new block never lands exactly on the last one.
          x: (count % 4) * 260,
          y: Math.floor(count / 4) * 140,
        },
      },
      { onError: (e) => toast.error(e.message) },
    );
  }

  function nudge(block: CanvasBlock, dx: number, dy: number) {
    if (!selectedId) return;
    updateBlock.mutate(
      {
        canvasId: selectedId,
        blockId: block.id,
        changes: { x: block.x + dx * GRID, y: block.y + dy * GRID },
      },
      // The server refuses a move off the navigable surface and says so;
      // surfacing that verbatim is more useful than a generic failure.
      { onError: (e) => toast.error(e.message) },
    );
  }

  if (!workspaceId) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Canvas</h1>
          <p className="text-sm text-muted-foreground">
            Arrange notes and links to your work on a surface, instead of in a list.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTitle.trim()) return;
            create.mutate(newTitle.trim(), {
              onSuccess: (c) => {
                setSelectedId(c.id);
                setNewTitle('');
              },
              onError: (err) => toast.error(err.message),
            });
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New canvas title"
            aria-label="New canvas title"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button type="submit" disabled={create.isPending || !newTitle.trim()}>
            {create.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Create
          </Button>
        </form>
      </div>

      {isLoading ? (
        <Spinner />
      ) : canvases.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-8 w-8" />}
          title="No canvases yet"
          description="A canvas holds notes and links to conversations, runs and workflows, arranged however makes sense to you."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <ul className="space-y-2">
            {canvases.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-current={selectedId === c.id}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${
                    selectedId === c.id ? 'border-primary bg-muted' : 'hover:bg-muted'
                  }`}
                >
                  <span className="font-medium">{c.title}</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.blocks.length} block{c.blocks.length === 1 ? '' : 's'}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-4">
            {!canvas ? (
              <p className="text-sm text-muted-foreground">Select a canvas to open it.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="flex-1 font-semibold">{canvas.title}</h2>
                  <Button variant="outline" size="sm" onClick={() => add('text')}>
                    <Plus className="mr-1 h-3 w-3" />
                    Text
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => add('note')}>
                    <StickyNote className="mr-1 h-3 w-3" />
                    Note
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      archive.mutate(canvas.id, {
                        onSuccess: () => {
                          toast.success('Canvas archived — nothing was destroyed');
                          setSelectedId(null);
                        },
                        onError: (e) => toast.error(e.message),
                      })
                    }
                  >
                    <Archive className="mr-1 h-3 w-3" />
                    Archive
                  </Button>
                </div>

                {canvas.blocks.length === 0 ? (
                  <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                    Empty canvas. Add a text or note block to begin.
                  </p>
                ) : (
                  <div
                    role="list"
                    aria-label="Canvas blocks"
                    className="relative min-h-[24rem] overflow-auto rounded-md border bg-muted/30 p-4"
                  >
                    {canvas.blocks.map((block) => (
                      <div
                        key={block.id}
                        role="listitem"
                        aria-label={`${block.kind} block`}
                        style={{
                          position: 'absolute',
                          left: block.x + 16,
                          top: block.y + 16,
                          width: block.width,
                        }}
                        className={`rounded-md border p-2 shadow-sm ${BLOCK_STYLES[block.kind]}`}
                      >
                        {block.kind === 'link' ? (
                          <p className="text-sm">
                            <span className="font-medium">{block.content}</span>
                            <span className="block text-xs text-muted-foreground">
                              {block.target}: {block.targetId}
                            </span>
                          </p>
                        ) : (
                          <textarea
                            value={block.content}
                            aria-label={`Content of ${block.kind} block`}
                            onChange={(e) =>
                              updateBlock.mutate({
                                canvasId: canvas.id,
                                blockId: block.id,
                                changes: { content: e.target.value },
                              })
                            }
                            rows={2}
                            className="w-full resize-none bg-transparent text-sm outline-none"
                          />
                        )}

                        <div className="mt-1 flex gap-1">
                          {(
                            [
                              ['←', -1, 0],
                              ['→', 1, 0],
                              ['↑', 0, -1],
                              ['↓', 0, 1],
                            ] as const
                          ).map(([label, dx, dy]) => (
                            <button
                              key={label}
                              type="button"
                              aria-label={`Move ${block.kind} block ${
                                dx === -1 ? 'left' : dx === 1 ? 'right' : dy === -1 ? 'up' : 'down'
                              }`}
                              onClick={() => nudge(block, dx, dy)}
                              className="rounded border px-1 text-xs hover:bg-muted"
                            >
                              {label}
                            </button>
                          ))}
                          <button
                            type="button"
                            aria-label={`Remove ${block.kind} block`}
                            onClick={() =>
                              removeBlock.mutate(
                                { canvasId: canvas.id, blockId: block.id },
                                { onError: (e) => toast.error(e.message) },
                              )
                            }
                            className="ml-auto rounded border px-1 text-xs hover:bg-muted"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Blocks move in {GRID}px steps. Dragging is not built yet — this is the first
                  version of the surface, and how people actually arrange a canvas will decide
                  what it should become.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
