/**
 * Canvas store tests.
 *
 * Two properties carry the weight. First, the surface is bounded — every
 * other subsystem here has budgets because unbounded anything eventually
 * becomes an outage, and a canvas is no different. Second, a partial
 * update is validated as the block WOULD BE rather than as the change
 * alone, so supplying one coordinate cannot move a block somewhere it
 * could never have been placed.
 *
 * The hydration rule differs deliberately from the agent registry's and
 * that difference is asserted: a malformed agent definition is discarded
 * whole because it would otherwise hand an executor a configuration nobody
 * wrote, whereas a canvas keeps its good blocks — losing one bad note is
 * better than losing the afternoon's work around it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKeyedStore } from '../../agents/agent-stores';
import {
  addBlock,
  archiveCanvas,
  createCanvas,
  getCanvas,
  hydrateCanvases,
  listCanvases,
  persistCanvas,
  removeBlock,
  renameCanvas,
  resetCanvases,
  setCanvasStore,
  updateBlock,
} from '../canvas-store';
import { CANVAS_LIMITS, type CanvasDocument } from '../types';

const WS = 'ws_alpha';

function makeCanvas(title = 'Launch plan') {
  return createCanvas({ workspaceId: WS, title, createdBy: 'u1' });
}

const textBlock = { kind: 'text' as const, content: 'hello', x: 10, y: 20 };

beforeEach(() => {
  resetCanvases();
  setCanvasStore(new InMemoryKeyedStore<CanvasDocument>());
});

describe('canvas documents', () => {
  it('creates an empty canvas and lists it', () => {
    const canvas = makeCanvas();
    expect(canvas.blocks).toEqual([]);
    expect(canvas.archived).toBe(false);
    expect(listCanvases(WS)).toHaveLength(1);
  });

  it('refuses a canvas with no title', () => {
    expect(() => createCanvas({ workspaceId: WS, title: '   ', createdBy: 'u1' })).toThrow(
      /needs a title/,
    );
  });

  it('scopes lookups and listing to the workspace', () => {
    const canvas = makeCanvas();
    expect(getCanvas(canvas.id, 'ws_other')).toBeNull();
    expect(listCanvases('ws_other')).toEqual([]);
  });

  it('archives rather than deletes', () => {
    const canvas = makeCanvas();
    expect(archiveCanvas(canvas.id, WS).archived).toBe(true);
    expect(listCanvases(WS)).toHaveLength(0);
    expect(listCanvases(WS, { includeArchived: true })).toHaveLength(1);
    // Nothing destroyed: a canvas someone spent an afternoon on stays.
    expect(getCanvas(canvas.id, WS)).not.toBeNull();
  });

  it('renames, and refuses an empty rename', () => {
    const canvas = makeCanvas();
    expect(renameCanvas(canvas.id, WS, 'Q4 plan').title).toBe('Q4 plan');
    expect(() => renameCanvas(canvas.id, WS, '  ')).toThrow(/needs a title/);
  });
});

describe('blocks', () => {
  it('adds a block with sensible defaults and bumps the canvas timestamp', () => {
    const canvas = makeCanvas();
    const before = canvas.updatedAt;
    const block = addBlock(canvas.id, WS, textBlock);

    expect(block.kind).toBe('text');
    expect(block.width).toBeGreaterThan(0);
    expect(block.height).toBeGreaterThan(0);
    expect(getCanvas(canvas.id, WS)!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('refuses an unknown block kind rather than guessing', () => {
    const canvas = makeCanvas();
    expect(() =>
      addBlock(canvas.id, WS, { ...textBlock, kind: 'video' as never }),
    ).toThrow(/unknown block kind/);
  });

  it('refuses a link block that points at nothing', () => {
    const canvas = makeCanvas();
    // A link with nothing to link to is a dead block that looks live.
    expect(() => addBlock(canvas.id, WS, { ...textBlock, kind: 'link' })).toThrow(
      /must name what it points at/,
    );
  });

  it('refuses a target on a non-link block', () => {
    const canvas = makeCanvas();
    expect(() =>
      addBlock(canvas.id, WS, { ...textBlock, target: 'run', targetId: 'run_1' }),
    ).toThrow(/only a link block/);
  });

  it('stores a link as ids, never as a copied snapshot', () => {
    const canvas = makeCanvas();
    const block = addBlock(canvas.id, WS, {
      kind: 'link',
      content: 'Last night’s run',
      target: 'run',
      targetId: 'run_42',
      x: 0,
      y: 0,
    });

    // Resolved when read, so a canvas cannot drift out of date with the
    // thing it points at, or become a second stale copy of it.
    expect(block.target).toBe('run');
    expect(block.targetId).toBe('run_42');
  });

  it('refuses a block placed off the navigable surface', () => {
    const canvas = makeCanvas();
    expect(() =>
      addBlock(canvas.id, WS, { ...textBlock, x: CANVAS_LIMITS.maxCoordinate + 1 }),
    ).toThrow(/cannot be found again/);
  });

  it('caps the number of blocks on one canvas', () => {
    const canvas = makeCanvas();
    for (let i = 0; i < CANVAS_LIMITS.maxBlocks; i += 1) {
      addBlock(canvas.id, WS, { ...textBlock, x: i });
    }
    // Unbounded anything eventually becomes an outage.
    expect(() => addBlock(canvas.id, WS, textBlock)).toThrow(/at most/);
  });

  it('caps content length', () => {
    const canvas = makeCanvas();
    expect(() =>
      addBlock(canvas.id, WS, {
        ...textBlock,
        content: 'x'.repeat(CANVAS_LIMITS.maxContentLength + 1),
      }),
    ).toThrow(/exceeds/);
  });

  it('validates a partial update as the block would be, not as the change alone', () => {
    const canvas = makeCanvas();
    const block = addBlock(canvas.id, WS, textBlock);

    // Only x is supplied. Validating the change in isolation would let it
    // through; validating the resulting block refuses it.
    expect(() =>
      updateBlock(canvas.id, WS, block.id, { x: CANVAS_LIMITS.maxCoordinate + 1 }),
    ).toThrow(/cannot be found again/);

    // And the block is untouched by the refused update.
    expect(getCanvas(canvas.id, WS)!.blocks[0].x).toBe(10);
  });

  it('updates content and position', () => {
    const canvas = makeCanvas();
    const block = addBlock(canvas.id, WS, textBlock);

    const updated = updateBlock(canvas.id, WS, block.id, { content: 'goodbye', x: 99 });
    expect(updated.content).toBe('goodbye');
    expect(updated.x).toBe(99);
    expect(updated.y).toBe(20);
  });

  it('removes a block and reports whether anything was removed', () => {
    const canvas = makeCanvas();
    const block = addBlock(canvas.id, WS, textBlock);

    expect(removeBlock(canvas.id, WS, block.id)).toBe(true);
    expect(removeBlock(canvas.id, WS, block.id)).toBe(false);
    expect(getCanvas(canvas.id, WS)!.blocks).toHaveLength(0);
  });

  it('will not touch a canvas in another workspace', () => {
    const canvas = makeCanvas();
    expect(() => addBlock(canvas.id, 'ws_other', textBlock)).toThrow(/not found/);
    expect(() => removeBlock(canvas.id, 'ws_other', 'block_x')).toThrow(/not found/);
  });
});

describe('canvas durability', () => {
  it('restores a canvas with its blocks', async () => {
    const canvas = makeCanvas();
    addBlock(canvas.id, WS, textBlock);
    await persistCanvas(canvas.id);

    resetCanvases();
    expect(await hydrateCanvases()).toEqual({ loaded: 1, droppedBlocks: 0 });
    expect(getCanvas(canvas.id, WS)!.blocks).toHaveLength(1);
  });

  it('keeps the good blocks and drops only the bad ones', async () => {
    const store = new InMemoryKeyedStore<CanvasDocument>();
    await store.save('canvas_1', {
      id: 'canvas_1',
      workspaceId: WS,
      title: 'Mixed',
      blocks: [
        { id: 'b1', kind: 'text', content: 'fine', x: 0, y: 0, width: 10, height: 10, createdAt: 1, updatedAt: 1 },
        // Off the surface — an older version might have written it.
        { id: 'b2', kind: 'text', content: 'lost', x: 1e9, y: 0, width: 10, height: 10, createdAt: 1, updatedAt: 1 },
      ],
      createdBy: 'u1',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    setCanvasStore(store);

    // Deliberately unlike the agent registry, which discards a malformed
    // definition whole: there, a bad record would hand an executor a
    // configuration nobody wrote. Here, losing one note is better than
    // losing everything around it.
    expect(await hydrateCanvases()).toEqual({ loaded: 1, droppedBlocks: 1 });
    expect(getCanvas('canvas_1', WS)!.blocks.map((b) => b.id)).toEqual(['b1']);
  });

  it('restores an archived canvas as archived', async () => {
    const canvas = makeCanvas();
    archiveCanvas(canvas.id, WS);
    await persistCanvas(canvas.id);

    resetCanvases();
    await hydrateCanvases();
    expect(getCanvas(canvas.id, WS)!.archived).toBe(true);
  });
});
