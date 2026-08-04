'use client';

import { useState } from 'react';
import {
  Archive,
  LayoutGrid,
  Link2,
  Loader2,
  Maximize,
  Plus,
  StickyNote,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button, EmptyState, Spinner } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useAddBlock,
  useArchiveCanvas,
  useCanvas,
  useCanvases,
  useConnectBlocks,
  useCreateCanvas,
  useDisconnectBlocks,
  useRemoveBlock,
  useUpdateBlock,
  type BlockKind,
  type CanvasBlock,
  type CanvasConnection,
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
 * without extra work. Zoom and pan follow the same reasoning: buttons
 * with labels, reachable by keyboard, rather than wheel and drag gestures
 * that are invisible until discovered.
 *
 * UNDO IS STRUCTURAL, NOT TEXTUAL. Typing already has an undo — the
 * browser's, inside the textarea — and recording an entry per keystroke
 * would bury the changes people actually want back. What the stack holds
 * is: what exists, where it sits, and what connects to what.
 */

const GRID = 20;
const PAN = 80;
const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

/**
 * One reversal, described as data rather than as a closure, so the stack
 * can be inspected and so undoing does not capture stale component state.
 *
 * TEXT EDITS ARE DELIBERATELY ABSENT. Typing already has an undo — the
 * browser's, inside the textarea — and pushing an entry per keystroke
 * would bury the structural changes people actually want back. This stack
 * covers structure: what exists, where it sits, and what connects to what.
 */
type UndoEntry =
  | { kind: 'removeBlock'; blockId: string; label: string }
  | {
      kind: 'restoreBlock';
      block: CanvasBlock;
      connections: CanvasConnection[];
      label: string;
    }
  | { kind: 'moveBlock'; blockId: string; x: number; y: number; label: string }
  | { kind: 'disconnect'; connectionId: string; label: string }
  | { kind: 'connect'; from: string; to: string; label?: string; text: string };

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
  /** The block a connection is being drawn FROM, once one is chosen. */
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  const { data: canvases = [], isLoading } = useCanvases(workspaceId);
  const { data: canvas } = useCanvas(workspaceId, selectedId ?? '', { enabled: !!selectedId });
  const create = useCreateCanvas(workspaceId);
  const archive = useArchiveCanvas(workspaceId);
  const addBlock = useAddBlock(workspaceId);
  const updateBlock = useUpdateBlock(workspaceId);
  const removeBlock = useRemoveBlock(workspaceId);
  const connect = useConnectBlocks(workspaceId);
  const disconnect = useDisconnectBlocks(workspaceId);

  const connections = canvas?.connections ?? [];

  function pushUndo(entry: UndoEntry) {
    // Bounded, like everything else here: an unbounded history is a slow
    // memory leak that only shows up in a long session.
    setUndoStack((stack) => [...stack.slice(-49), entry]);
  }

  /**
   * Reverses the last structural change.
   *
   * RESTORING A DELETED BLOCK GIVES IT A NEW ID, and that is genuinely
   * fine rather than a compromise: nothing outside this canvas refers to a
   * block id, so a restored block plus its restored connections is
   * functionally the state that existed before. Link blocks point at
   * conversations and runs by THEIR ids, which are untouched.
   */
  function undo() {
    if (!canvas || undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    const onError = (e: Error) => toast.error(e.message);

    switch (entry.kind) {
      case 'removeBlock':
        removeBlock.mutate({ canvasId: canvas.id, blockId: entry.blockId }, { onError });
        return;
      case 'moveBlock':
        updateBlock.mutate(
          { canvasId: canvas.id, blockId: entry.blockId, changes: { x: entry.x, y: entry.y } },
          { onError },
        );
        return;
      case 'disconnect':
        disconnect.mutate({ canvasId: canvas.id, connectionId: entry.connectionId }, { onError });
        return;
      case 'connect':
        connect.mutate(
          { canvasId: canvas.id, from: entry.from, to: entry.to, label: entry.label },
          { onError },
        );
        return;
      case 'restoreBlock':
        addBlock.mutate(
          {
            canvasId: canvas.id,
            input: {
              kind: entry.block.kind,
              content: entry.block.content,
              target: entry.block.target,
              targetId: entry.block.targetId,
              x: entry.block.x,
              y: entry.block.y,
              width: entry.block.width,
              height: entry.block.height,
            },
          },
          {
            onSuccess: (restored) => {
              // The lines that died with it come back too, re-pointed at
              // the new id. Without this, "undo" would return a lonely
              // block and quietly lose the structure around it.
              for (const c of entry.connections) {
                connect.mutate({
                  canvasId: canvas.id,
                  from: c.from === entry.block.id ? restored.id : c.from,
                  to: c.to === entry.block.id ? restored.id : c.to,
                  label: c.label,
                });
              }
            },
            onError,
          },
        );
        return;
    }
  }

  function deleteBlock(block: CanvasBlock) {
    if (!canvas) return;
    // Captured BEFORE the request, because the server deletes the lines
    // along with the block and they are unrecoverable afterwards.
    const touching = connections.filter((c) => c.from === block.id || c.to === block.id);
    removeBlock.mutate(
      { canvasId: canvas.id, blockId: block.id },
      {
        onSuccess: () =>
          pushUndo({
            kind: 'restoreBlock',
            block,
            connections: touching,
            label: `deleting the ${block.kind} block`,
          }),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function blockCentre(block: CanvasBlock) {
    return { cx: block.x + 16 + block.width / 2, cy: block.y + 16 + block.height / 2 };
  }

  function onConnectClick(blockId: string) {
    if (!canvas) return;
    if (!connectFrom) {
      setConnectFrom(blockId);
      return;
    }
    if (connectFrom === blockId) {
      // Clicking the same block again cancels rather than attempting a
      // self-connection the server would refuse anyway.
      setConnectFrom(null);
      return;
    }
    connect.mutate(
      { canvasId: canvas.id, from: connectFrom, to: blockId },
      {
        onSuccess: (created) => {
          setConnectFrom(null);
          pushUndo({
            kind: 'disconnect',
            connectionId: created.id,
            label: 'connecting two blocks',
          });
        },
        onError: (e) => {
          toast.error(e.message);
          setConnectFrom(null);
        },
      },
    );
  }

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
      {
        onSuccess: (created) =>
          pushUndo({ kind: 'removeBlock', blockId: created.id, label: `adding a ${kind} block` }),
        onError: (e) => toast.error(e.message),
      },
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
      {
        onSuccess: () =>
          // The position BEFORE the move — captured from the block the
          // caller already had, so undo restores where it actually was.
          pushUndo({
            kind: 'moveBlock',
            blockId: block.id,
            x: block.x,
            y: block.y,
            label: `moving the ${block.kind} block`,
          }),
        // The server refuses a move off the navigable surface and says so;
        // surfacing that verbatim is more useful than a generic failure.
        onError: (e) => toast.error(e.message),
      },
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

                <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Zoom out"
                    onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
                    disabled={zoom <= MIN_ZOOM}
                  >
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Zoom in"
                    onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
                    disabled={zoom >= MAX_ZOOM}
                  >
                    <ZoomIn className="h-3 w-3" />
                  </Button>

                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />

                  {(
                    [
                      ['Pan left', -1, 0],
                      ['Pan right', 1, 0],
                      ['Pan up', 0, -1],
                      ['Pan down', 0, 1],
                    ] as const
                  ).map(([label, dx, dy]) => (
                    <Button
                      key={label}
                      variant="outline"
                      size="sm"
                      aria-label={label}
                      onClick={() =>
                        setPan((p) => ({ x: p.x - dx * PAN, y: p.y - dy * PAN }))
                      }
                    >
                      {dx === -1 ? '←' : dx === 1 ? '→' : dy === -1 ? '↑' : '↓'}
                    </Button>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Reset view"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                  >
                    <Maximize className="mr-1 h-3 w-3" />
                    Reset view
                  </Button>

                  <span className="flex-1" />

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={undo}
                    disabled={undoStack.length === 0}
                  >
                    <Undo2 className="mr-1 h-3 w-3" />
                    {undoStack.length === 0
                      ? 'Nothing to undo'
                      : `Undo ${undoStack[undoStack.length - 1].kind === 'connect' ? (undoStack[undoStack.length - 1] as { text: string }).text : (undoStack[undoStack.length - 1] as { label: string }).label}`}
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
                    {/* One transformed layer holds both the lines and the
                        blocks, so a connection cannot drift away from the
                        blocks it joins when the view changes. */}
                    <div
                      style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'top left',
                      }}
                    >
                    {/* Lines sit behind the blocks and never intercept
                        clicks — a connection is deleted from the list
                        below, where it has a name and a label. */}
                    <svg
                      aria-hidden
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      {connections.map((c) => {
                        const from = canvas.blocks.find((b) => b.id === c.from);
                        const to = canvas.blocks.find((b) => b.id === c.to);
                        if (!from || !to) return null;
                        const a = blockCentre(from);
                        const b = blockCentre(to);
                        return (
                          <line
                            key={c.id}
                            x1={a.cx}
                            y1={a.cy}
                            x2={b.cx}
                            y2={b.cy}
                            stroke="currentColor"
                            strokeWidth={1.5}
                            className="text-muted-foreground"
                          />
                        );
                      })}
                    </svg>

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
                            aria-label={
                              connectFrom === block.id
                                ? `Cancel connecting from this ${block.kind} block`
                                : connectFrom
                                  ? `Connect to this ${block.kind} block`
                                  : `Connect from this ${block.kind} block`
                            }
                            onClick={() => onConnectClick(block.id)}
                            className={`rounded border px-1 text-xs hover:bg-muted ${
                              connectFrom === block.id ? 'border-primary bg-primary/10' : ''
                            }`}
                          >
                            <Link2 className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${block.kind} block`}
                            onClick={() => deleteBlock(block)}
                            className="ml-auto rounded border px-1 text-xs hover:bg-muted"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                )}

                {connectFrom && (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 p-2 text-sm"
                  >
                    <Link2 className="h-4 w-4" aria-hidden />
                    <span className="flex-1">
                      Pick the block this one connects to. Picking the same block again cancels.
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setConnectFrom(null)}>
                      <X className="mr-1 h-3 w-3" />
                      Cancel
                    </Button>
                  </div>
                )}

                {connections.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      Connections ({connections.length})
                    </h3>
                    <ul className="space-y-1">
                      {connections.map((c) => {
                        const from = canvas.blocks.find((b) => b.id === c.from);
                        const to = canvas.blocks.find((b) => b.id === c.to);
                        const label = (b?: CanvasBlock) =>
                          (b?.content || '').slice(0, 30) || '(untitled block)';
                        return (
                          <li
                            key={c.id}
                            className="flex items-center gap-2 rounded-md border p-2 text-xs"
                          >
                            <span className="flex-1">
                              {label(from)} → {label(to)}
                              {c.label ? ` (${c.label})` : ''}
                            </span>
                            <button
                              type="button"
                              aria-label="Remove connection"
                              onClick={() =>
                                disconnect.mutate(
                                  { canvasId: canvas.id, connectionId: c.id },
                                  {
                                    onSuccess: () =>
                                      pushUndo({
                                        kind: 'connect',
                                        from: c.from,
                                        to: c.to,
                                        label: c.label,
                                        text: 'removing a connection',
                                      }),
                                    onError: (e) => toast.error(e.message),
                                  },
                                )
                              }
                              className="rounded border px-1 hover:bg-muted"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                <p className="text-xs text-muted-foreground">
                  Blocks move in {GRID}px steps. Dragging is not built yet — this is the first
                  version of the surface, and how people actually arrange a canvas will decide
                  what it should become. Deleting a block also deletes the lines that touched
                  it; undo brings both back. Undo covers structure — what exists, where it
                  sits, and what connects to what — not typing, where your browser&rsquo;s own
                  undo already works inside the text box.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
