import { randomUUID } from 'node:crypto';
import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from '../agents/agent-stores.js';
import {
  CANVAS_LIMITS,
  type BlockKind,
  type CanvasBlock,
  type CanvasConnection,
  type CanvasDocument,
  type LinkTarget,
} from './types.js';

/**
 * Canvas documents: workspace-scoped, mutable, bounded.
 *
 * BOUNDED IS THE INTERESTING PART. Every other subsystem here has budgets
 * — step counts, tool calls, wall clock — because unbounded anything
 * eventually becomes an outage. A canvas is no different: without limits,
 * one document can hold a hundred thousand blocks and every read of it
 * becomes a slow request that nobody can cancel. So blocks are capped,
 * content length is capped, and coordinates are capped to a surface a
 * person could actually navigate to.
 *
 * The coordinate cap is the one worth explaining: a block placed at
 * 10^9 is not "far away", it is lost. Refusing the placement is kinder
 * than accepting it and letting someone wonder where their note went.
 */

const documents = new Map<string, CanvasDocument>();
let store: KeyedStore<CanvasDocument> = new InMemoryKeyedStore();

export function setCanvasStore(next: KeyedStore<CanvasDocument>): void {
  store = next;
}
export function createFileCanvasStore(filePath: string): KeyedStore<CanvasDocument> {
  return new FileKeyedStore<CanvasDocument>(filePath);
}

export interface BlockInput {
  kind: BlockKind;
  content: string;
  target?: LinkTarget;
  targetId?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

function validateBlock(input: BlockInput): void {
  if (input.kind !== 'text' && input.kind !== 'note' && input.kind !== 'link') {
    throw new Error(`unknown block kind ${JSON.stringify(String(input.kind))}`);
  }
  if (input.content.length > CANVAS_LIMITS.maxContentLength) {
    throw new Error(`block content exceeds ${CANVAS_LIMITS.maxContentLength} characters`);
  }
  if (input.kind === 'link') {
    // A link with nothing to link to is a dead block that looks live.
    if (!input.target || !input.targetId) {
      throw new Error('a link block must name what it points at');
    }
  } else if (input.target || input.targetId) {
    throw new Error('only a link block may name a target');
  }
  for (const [axis, value] of [
    ['x', input.x],
    ['y', input.y],
  ] as const) {
    if (!Number.isFinite(value) || Math.abs(value) > CANVAS_LIMITS.maxCoordinate) {
      // Not "far away" — lost. Refusing is kinder than accepting.
      throw new Error(
        `${axis} must be within ±${CANVAS_LIMITS.maxCoordinate}; a block outside the surface cannot be found again`,
      );
    }
  }
  for (const [dim, value] of [
    ['width', input.width],
    ['height', input.height],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < CANVAS_LIMITS.minSize || value > CANVAS_LIMITS.maxSize) {
      throw new Error(`${dim} must be between ${CANVAS_LIMITS.minSize} and ${CANVAS_LIMITS.maxSize}`);
    }
  }
}

export function createCanvas(input: {
  workspaceId: string;
  title: string;
  createdBy: string;
}): CanvasDocument {
  const title = input.title.trim();
  if (title.length === 0) throw new Error('a canvas needs a title');
  if (title.length > CANVAS_LIMITS.maxTitleLength) {
    throw new Error(`title exceeds ${CANVAS_LIMITS.maxTitleLength} characters`);
  }

  const now = Date.now();
  const canvas: CanvasDocument = {
    id: `canvas_${randomUUID()}`,
    workspaceId: input.workspaceId,
    title,
    blocks: [],
    connections: [],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
  documents.set(canvas.id, canvas);
  return canvas;
}

/** Documents stored before connections existed have no array. */
function connectionsOf(canvas: CanvasDocument): CanvasConnection[] {
  if (!canvas.connections) canvas.connections = [];
  return canvas.connections;
}

/** Workspace scoping is part of the lookup, as everywhere else. */
export function getCanvas(canvasId: string, workspaceId: string): CanvasDocument | null {
  const canvas = documents.get(canvasId);
  if (!canvas || canvas.workspaceId !== workspaceId) return null;
  return canvas;
}

export function listCanvases(
  workspaceId: string,
  opts: { includeArchived?: boolean } = {},
): CanvasDocument[] {
  return [...documents.values()]
    .filter((c) => c.workspaceId === workspaceId)
    .filter((c) => !c.archived || opts.includeArchived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function renameCanvas(canvasId: string, workspaceId: string, title: string): CanvasDocument {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error('a canvas needs a title');
  if (trimmed.length > CANVAS_LIMITS.maxTitleLength) {
    throw new Error(`title exceeds ${CANVAS_LIMITS.maxTitleLength} characters`);
  }
  canvas.title = trimmed;
  canvas.updatedAt = Date.now();
  return canvas;
}

export function addBlock(
  canvasId: string,
  workspaceId: string,
  input: BlockInput,
): CanvasBlock {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');
  if (canvas.blocks.length >= CANVAS_LIMITS.maxBlocks) {
    throw new Error(`a canvas holds at most ${CANVAS_LIMITS.maxBlocks} blocks`);
  }
  validateBlock(input);

  const now = Date.now();
  const block: CanvasBlock = {
    id: `block_${randomUUID()}`,
    kind: input.kind,
    content: input.content,
    target: input.target,
    targetId: input.targetId,
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.round(input.width ?? 240),
    height: Math.round(input.height ?? 120),
    createdAt: now,
    updatedAt: now,
  };
  canvas.blocks.push(block);
  canvas.updatedAt = now;
  return block;
}

export function updateBlock(
  canvasId: string,
  workspaceId: string,
  blockId: string,
  changes: Partial<Pick<BlockInput, 'content' | 'x' | 'y' | 'width' | 'height'>>,
): CanvasBlock {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');
  const block = canvas.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error('block not found');

  // Validated as the block WOULD BE, not as the change alone: a partial
  // update must not be able to move a block off the surface just because
  // it only supplied one coordinate.
  validateBlock({
    kind: block.kind,
    content: changes.content ?? block.content,
    target: block.target,
    targetId: block.targetId,
    x: changes.x ?? block.x,
    y: changes.y ?? block.y,
    width: changes.width ?? block.width,
    height: changes.height ?? block.height,
  });

  if (changes.content !== undefined) block.content = changes.content;
  if (changes.x !== undefined) block.x = Math.round(changes.x);
  if (changes.y !== undefined) block.y = Math.round(changes.y);
  if (changes.width !== undefined) block.width = Math.round(changes.width);
  if (changes.height !== undefined) block.height = Math.round(changes.height);
  block.updatedAt = Date.now();
  canvas.updatedAt = block.updatedAt;
  return block;
}

export function removeBlock(canvasId: string, workspaceId: string, blockId: string): boolean {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');
  const before = canvas.blocks.length;
  canvas.blocks = canvas.blocks.filter((b) => b.id !== blockId);
  if (canvas.blocks.length === before) return false;
  // Every line touching this block goes with it. A connection to a block
  // that no longer exists is drawn from nothing to nothing.
  canvas.connections = connectionsOf(canvas).filter(
    (c) => c.from !== blockId && c.to !== blockId,
  );
  canvas.updatedAt = Date.now();
  return true;
}

export function connectBlocks(
  canvasId: string,
  workspaceId: string,
  input: { from: string; to: string; label?: string },
): CanvasConnection {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');

  if (input.from === input.to) {
    // A block connected to itself draws a line that says nothing.
    throw new Error('a block cannot be connected to itself');
  }
  for (const end of [input.from, input.to]) {
    if (!canvas.blocks.some((b) => b.id === end)) {
      throw new Error('a connection must join two blocks that exist on this canvas');
    }
  }
  if ((input.label?.length ?? 0) > CANVAS_LIMITS.maxLabelLength) {
    throw new Error(`a connection label exceeds ${CANVAS_LIMITS.maxLabelLength} characters`);
  }

  const connections = connectionsOf(canvas);
  if (connections.length >= CANVAS_LIMITS.maxConnections) {
    throw new Error(`a canvas holds at most ${CANVAS_LIMITS.maxConnections} connections`);
  }
  // Same direction between the same pair is one line, not two stacked
  // invisibly on top of each other. The reverse direction is a separate,
  // legitimate connection.
  if (connections.some((c) => c.from === input.from && c.to === input.to)) {
    throw new Error('these blocks are already connected in that direction');
  }

  const connection: CanvasConnection = {
    id: `conn_${randomUUID()}`,
    from: input.from,
    to: input.to,
    label: input.label,
    createdAt: Date.now(),
  };
  connections.push(connection);
  canvas.updatedAt = connection.createdAt;
  return connection;
}

export function disconnectBlocks(
  canvasId: string,
  workspaceId: string,
  connectionId: string,
): boolean {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');
  const connections = connectionsOf(canvas);
  const before = connections.length;
  canvas.connections = connections.filter((c) => c.id !== connectionId);
  if (canvas.connections.length === before) return false;
  canvas.updatedAt = Date.now();
  return true;
}

/** Archive, not delete: a canvas someone spent an afternoon on stays. */
export function archiveCanvas(canvasId: string, workspaceId: string): CanvasDocument {
  const canvas = getCanvas(canvasId, workspaceId);
  if (!canvas) throw new Error('canvas not found');
  canvas.archived = true;
  canvas.updatedAt = Date.now();
  return canvas;
}

export async function persistCanvas(canvasId: string): Promise<boolean> {
  const canvas = documents.get(canvasId);
  if (!canvas) return false;
  await store.save(canvas.id, canvas);
  return true;
}

/**
 * Loads canvases at startup. A stored document whose blocks no longer
 * validate is loaded WITH THE OFFENDING BLOCKS DROPPED rather than
 * discarded whole — unlike an agent definition, where a malformed record
 * would hand an executor a configuration nobody wrote. A canvas is a
 * surface, not an executor: losing one bad block costs a note, while
 * discarding the document costs everything on it.
 */
export async function hydrateCanvases(): Promise<{
  loaded: number;
  droppedBlocks: number;
  droppedConnections: number;
}> {
  const stored = await store.loadAll();
  let loaded = 0;
  let droppedBlocks = 0;
  let droppedConnections = 0;

  for (const canvas of Object.values(stored)) {
    if (!canvas?.id || !canvas.workspaceId) continue;
    const kept: CanvasBlock[] = [];
    for (const block of canvas.blocks ?? []) {
      try {
        validateBlock(block);
        kept.push(block);
      } catch {
        droppedBlocks += 1;
      }
    }
    canvas.blocks = kept.slice(0, CANVAS_LIMITS.maxBlocks);

    // The no-dangling-edges invariant has to hold on load too: a block
    // dropped just above (or by an older version of this code) would
    // otherwise leave a line pointing at nothing.
    const survivingIds = new Set(canvas.blocks.map((b) => b.id));
    const keptConnections = (canvas.connections ?? [])
      .filter((c) => c?.id && survivingIds.has(c.from) && survivingIds.has(c.to))
      .slice(0, CANVAS_LIMITS.maxConnections);
    droppedConnections += (canvas.connections ?? []).length - keptConnections.length;
    canvas.connections = keptConnections;

    documents.set(canvas.id, canvas);
    loaded += 1;
  }
  return { loaded, droppedBlocks, droppedConnections };
}

/** Test-only. */
export function resetCanvases(): void {
  documents.clear();
}
