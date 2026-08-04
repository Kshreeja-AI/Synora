'use client';

import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Archive,
  GripVertical,
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
  useCanvasLinks,
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
 * THERE ARE TWO WAYS TO MOVE A BLOCK AND BOTH ARE PERMANENT. Dragging is
 * what people reach for, and it is now here. The nudge buttons stay,
 * because a drag is a pointer gesture and a pointer gesture is unreachable
 * by keyboard: removing them would take the surface away from anyone
 * navigating by tab and arrow keys, and an accessible path that only
 * exists until the pretty one ships is not an accessible path. Zoom and
 * pan follow the same reasoning — labelled buttons rather than wheel and
 * space-drag gestures that are invisible until someone tells you.
 *
 * DRAGGING IS BY A HANDLE, NOT THE WHOLE BLOCK. Text blocks are edited in
 * place, and if the body of the block started a drag then selecting a word
 * with the mouse would fling the block across the canvas instead.
 *
 * ONE SERVER CALL PER DRAG, ISSUED ON RELEASE. The position under the
 * pointer is local state until then. Writing every intermediate pixel
 * would be hundreds of requests for one gesture, and each one could fail
 * or arrive out of order — the block would end up wherever the slowest
 * response said, which is not where the person let go.
 *
 * UNDO IS STRUCTURAL, NOT TEXTUAL. Typing already has an undo — the
 * browser's, inside the textarea — and recording an entry per keystroke
 * would bury the changes people actually want back. What the stack holds
 * is: what exists, where it sits, and what connects to what. A whole drag
 * is one entry for the same reason it is one request.
 */

const GRID = 20;
const PAN = 80;
const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
/**
 * How far the pointer must travel before this counts as a drag rather than
 * a click that wobbled. Below it, nothing is written and no undo entry is
 * pushed, so a mis-click cannot fill the history with moves to nowhere.
 */
const DRAG_THRESHOLD = 3;

/**
 * A drag in progress. Held as state rather than a ref because the block
 * has to render under the pointer while it moves, and the lines joining it
 * have to follow.
 */
type DragState = {
  blockId: string;
  /**
   * Every block travelling with this gesture, including the grabbed one.
   * Captured at pointer-down so that changing the selection while the
   * pointer is down cannot change what is being moved underneath it.
   */
  movingIds: string[];
  /**
   * Carried rather than looked up on release, so the undo entry can name
   * the block the same way the nudge buttons do even if the block itself
   * has gone from the list by the time the pointer comes up.
   */
  kind: BlockKind;
  /** Where the pointer went down, in client coordinates. */
  pointerX: number;
  pointerY: number;
  /** Where the block sat before the gesture — what undo restores. */
  originX: number;
  originY: number;
  /** Where it sits right now, unsnapped, in canvas coordinates. */
  x: number;
  y: number;
  /** Whether the threshold has been crossed. */
  moved: boolean;
};

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

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
  /**
   * Several blocks moved as one gesture. A separate kind rather than a
   * loop pushing several `moveBlock` entries: moving four blocks together
   * is one thing the person did, and undoing it four times would be four
   * presses to reverse one action.
   */
  | { kind: 'moveBlocks'; positions: { blockId: string; x: number; y: number }[]; label: string }
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
  const [drag, setDrag] = useState<DragState | null>(null);
  /**
   * Blocks chosen to move together.
   *
   * SELECTION IS BY AN EXPLICIT TOGGLE, not by clicking the block. The
   * body of a text block is an editable field — making a click select
   * would mean clicking into your own text selected something instead, and
   * a modifier-click convention is invisible until somebody tells you it
   * exists. A labelled toggle is also the only version reachable from the
   * keyboard.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  // Only asked for once a canvas is open, and separately from the canvas
  // itself so a canvas whose targets have been deleted still opens.
  const { data: links = [] } = useCanvasLinks(workspaceId, selectedId ?? '', {
    enabled: !!selectedId,
  });
  function linkFor(blockId: string) {
    return links.find((l) => l.blockId === blockId);
  }

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
      case 'moveBlocks':
        // Each block back to where it actually was, rather than a shared
        // offset undone: if one request in the original move was refused,
        // an offset would put the survivors somewhere new.
        for (const position of entry.positions) {
          updateBlock.mutate(
            {
              canvasId: canvas.id,
              blockId: position.blockId,
              changes: { x: position.x, y: position.y },
            },
            { onError },
          );
        }
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
        onSuccess: () => {
          // A selection holding an id that no longer exists would make the
          // count say more blocks are selected than the canvas contains.
          setSelected((current) => {
            if (!current.has(block.id)) return current;
            const next = new Set(current);
            next.delete(block.id);
            return next;
          });
          pushUndo({
            kind: 'restoreBlock',
            block,
            connections: touching,
            label: `deleting the ${block.kind} block`,
          });
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  /**
   * Where a block should be drawn: under the pointer while it is being
   * dragged, otherwise wherever the server says it is. Everything that
   * draws a block — the block itself and the lines that reach it — goes
   * through here, so a line can never come adrift from its block.
   */
  function positionOf(block: CanvasBlock): { x: number; y: number } {
    if (!drag || !drag.movingIds.includes(block.id)) return { x: block.x, y: block.y };
    // Every block in the gesture shifts by the same offset, so a group
    // keeps its shape while it travels rather than collapsing onto the one
    // under the pointer.
    return { x: block.x + (drag.x - drag.originX), y: block.y + (drag.y - drag.originY) };
  }

  function blockCentre(block: CanvasBlock) {
    const { x, y } = positionOf(block);
    return { cx: x + 16 + block.width / 2, cy: y + 16 + block.height / 2 };
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

  /**
   * The blocks a gesture on `block` should move.
   *
   * Grabbing a SELECTED block moves the whole selection; grabbing an
   * unselected one moves just it, and leaves the selection alone. That
   * second rule matters: having some blocks selected must not make every
   * other block on the canvas un-nudgeable, and it must not silently drag
   * a selection somebody had set up for a different purpose.
   */
  function movingWith(block: CanvasBlock): CanvasBlock[] {
    if (!canvas || !selected.has(block.id)) return [block];
    return canvas.blocks.filter((b) => selected.has(b.id));
  }

  /** One label for both inputs and for one or many blocks. */
  function moveLabel(blocks: CanvasBlock[]): string {
    return blocks.length === 1
      ? `moving the ${blocks[0].kind} block`
      : `moving ${blocks.length} blocks`;
  }

  /**
   * Applies one offset to a set of blocks.
   *
   * ONE UNDO ENTRY FOR THE WHOLE SET, pushed once after the requests go
   * out rather than once per block: moving four blocks together is one
   * thing the person did, and undoing it four times would be four presses
   * to reverse one action. The requests themselves are per block because
   * that is the API the server offers; if one is refused the others still
   * land, and the refusal is shown.
   */
  function moveBy(blocks: CanvasBlock[], dx: number, dy: number) {
    if (!canvas || blocks.length === 0) return;
    const before = blocks.map((b) => ({ blockId: b.id, x: b.x, y: b.y }));
    for (const b of blocks) {
      updateBlock.mutate(
        { canvasId: canvas.id, blockId: b.id, changes: { x: b.x + dx, y: b.y + dy } },
        {
          // The server refuses a move off the navigable surface and says
          // so; surfacing that verbatim is more useful than a generic
          // failure.
          onError: (e) => toast.error(e.message),
        },
      );
    }
    pushUndo({ kind: 'moveBlocks', positions: before, label: moveLabel(blocks) });
  }

  function nudge(block: CanvasBlock, dx: number, dy: number) {
    moveBy(movingWith(block), dx * GRID, dy * GRID);
  }

  function toggleSelected(blockId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  function onBlockPointerDown(block: CanvasBlock, e: ReactPointerEvent<HTMLElement>) {
    // Only the primary button starts a drag; a right-click should reach
    // the context menu rather than pick the block up.
    if (e.button !== 0) return;
    e.preventDefault();
    // jsdom has no pointer capture, and a browser that lacks it still
    // works here — the move and release handlers live on the surface, so
    // capture is an improvement (events keep arriving if the pointer
    // outruns the handle) rather than a requirement.
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
      e.pointerId,
    );
    setDrag({
      blockId: block.id,
      kind: block.kind,
      // Captured at pointer-down, so changing the selection mid-drag
      // cannot change what is under the pointer.
      movingIds: movingWith(block).map((b) => b.id),
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: block.x,
      originY: block.y,
      x: block.x,
      y: block.y,
      moved: false,
    });
  }

  function onSurfacePointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!drag) return;
    const dx = e.clientX - drag.pointerX;
    const dy = e.clientY - drag.pointerY;
    setDrag({
      ...drag,
      // Divided by the zoom because the pointer moves in screen pixels
      // while the block lives in canvas pixels. Without this the block
      // lags the pointer when zoomed out and outruns it when zoomed in.
      x: drag.originX + dx / zoom,
      y: drag.originY + dy / zoom,
      moved: drag.moved || Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD,
    });
  }

  function onSurfacePointerUp() {
    if (!drag) return;
    const current = drag;
    setDrag(null);
    if (!current.moved || !canvas) return;

    // Snapped from the GRABBED block, and the resulting offset applied to
    // everything travelling with it — so the group lands on the grid
    // without its blocks being pulled onto grid points individually, which
    // would deform an arrangement somebody had deliberately made.
    const dx = snap(current.x) - current.originX;
    const dy = snap(current.y) - current.originY;
    // Snapping can land the block exactly where it started; writing that
    // would be a request that changes nothing and an undo entry that
    // undoes nothing.
    if (dx === 0 && dy === 0) return;

    const moving = canvas.blocks.filter((b) => current.movingIds.includes(b.id));
    // `moveBy` words the undo label the same way the nudge buttons do:
    // which input moved the blocks is not something the undo button
    // should make anyone think about.
    moveBy(moving, dx, dy);
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

                  {selected.size > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {selected.size} selected — they move together
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(new Set())}
                      >
                        Clear selection
                      </Button>
                    </>
                  )}

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
                    // The move and release handlers live on the surface
                    // rather than the handle so that a pointer which
                    // outruns the handle — or a release outside it — is
                    // still seen. Pointer capture usually makes that moot,
                    // but not every environment implements it.
                    onPointerMove={onSurfacePointerMove}
                    onPointerUp={onSurfacePointerUp}
                    // A cancelled pointer (the browser taking over for a
                    // scroll, a phone call arriving) is a released one as
                    // far as this is concerned; leaving `drag` set would
                    // strand the block under a pointer that no longer
                    // exists.
                    onPointerCancel={onSurfacePointerUp}
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

                    {canvas.blocks.map((block) => {
                      const dragging = drag?.blockId === block.id && drag.moved;
                      const at = positionOf(block);
                      return (
                      <div
                        key={block.id}
                        role="listitem"
                        aria-label={`${block.kind} block`}
                        style={{
                          position: 'absolute',
                          left: at.x + 16,
                          top: at.y + 16,
                          width: block.width,
                        }}
                        className={`rounded-md border p-2 shadow-sm ${BLOCK_STYLES[block.kind]} ${
                          dragging ? 'z-10 opacity-90 shadow-lg' : ''
                        } ${selected.has(block.id) ? 'ring-2 ring-primary' : ''}`}
                      >
                        <div className="mb-1 flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={selected.has(block.id)}
                            onChange={() => toggleSelected(block.id)}
                            aria-label={`Select ${block.kind} block`}
                            className="h-3 w-3 accent-primary"
                          />
                          <button
                            type="button"
                            aria-label={`Drag ${block.kind} block`}
                            onPointerDown={(e) => onBlockPointerDown(block, e)}
                            // Without this a touch drag scrolls the page
                            // instead of moving the block.
                            style={{ touchAction: 'none' }}
                            className="cursor-grab rounded px-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
                          >
                            <GripVertical className="h-3 w-3" />
                          </button>
                          {dragging && (
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {snap(at.x)}, {snap(at.y)}
                            </span>
                          )}
                        </div>

                        {block.kind === 'link' ? (
                          (() => {
                            const link = linkFor(block.id);
                            return (
                              <p className="text-sm">
                                <span className="font-medium">{block.content}</span>
                                {/* The target's own name, read now. Until
                                    the lookup answers, the block says what
                                    it points at rather than showing a
                                    placeholder that could be mistaken for
                                    a title. */}
                                {link?.missing ? (
                                  <span className="block text-xs text-destructive">
                                    This {block.target} is gone, or is not in this workspace.
                                  </span>
                                ) : link?.title ? (
                                  <>
                                    <span className="block text-xs font-medium">{link.title}</span>
                                    <span className="block text-xs text-muted-foreground">
                                      {block.target}
                                      {link.detail ? ` · ${link.detail}` : ''}
                                    </span>
                                  </>
                                ) : (
                                  <span className="block text-xs text-muted-foreground">
                                    {block.target}: {block.targetId}
                                  </span>
                                )}
                              </p>
                            );
                          })()
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
                      );
                    })}
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
                  Drag a block by its handle, or move it with the arrow buttons if you are
                  working from the keyboard. Either way it lands on a {GRID}px grid, and the
                  whole move counts as one step to undo. Tick several blocks and they travel
                  together, keeping their arrangement — moving an unticked block still moves
                  only that one, so a selection you set up for something else is not dragged
                  along by accident. Deleting a block also deletes the lines that touched it;
                  undo brings both back. Undo covers structure — what exists, where it sits,
                  and what connects to what — not typing, where your browser&rsquo;s own undo
                  already works inside the text box.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
