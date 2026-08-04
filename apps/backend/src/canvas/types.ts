/**
 * Canvas: a spatial surface for arranging work.
 *
 * WHY CANVAS BLOCKS ARE MUTABLE, when agent and workflow definitions are
 * not. This looks like an inconsistency and is a deliberate distinction.
 *
 * Agents and workflows are immutable because historical run records point
 * at them: "what was this configured to do when it did that?" must have an
 * answer, so the thing being pointed at must never change. A canvas is the
 * opposite kind of object — a working surface, edited continuously, that
 * nothing else references as a record of the past. Versioning every text
 * edit would produce thousands of dead versions and answer a question
 * nobody asks.
 *
 * Applying immutability everywhere would be cargo-culting a rule past the
 * reason for it. The rule is "anything a historical record points at
 * cannot change underneath it", not "nothing may ever be edited".
 *
 * WHAT A BLOCK MAY REFER TO. A block can link to a conversation, an agent
 * run, or a workflow. Those references are stored as ids and resolved when
 * read — never copied — so a canvas cannot drift out of date with the
 * thing it points at, and cannot become a second, stale copy of it.
 */

export type BlockKind = 'text' | 'note' | 'link';

/** What a `link` block points at. Ids only; never a copied snapshot. */
export type LinkTarget = 'conversation' | 'run' | 'workflow' | 'agent';

export interface CanvasBlock {
  id: string;
  kind: BlockKind;
  /** Free text for `text` and `note`; the label for `link`. */
  content: string;
  /** Present only on `link` blocks. */
  target?: LinkTarget;
  targetId?: string;
  /** Position on the surface. Integers; the client decides the unit. */
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasDocument {
  id: string;
  workspaceId: string;
  title: string;
  blocks: CanvasBlock[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Archived canvases are hidden from lists; nothing is destroyed. */
  archived: boolean;
}

/** Bounds that keep a canvas navigable and a payload bounded. */
export const CANVAS_LIMITS = {
  maxBlocks: 200,
  maxContentLength: 20_000,
  maxTitleLength: 200,
  /** The surface is finite: a block placed at 10^9 is unreachable. */
  maxCoordinate: 100_000,
  minSize: 1,
  maxSize: 10_000,
} as const;
