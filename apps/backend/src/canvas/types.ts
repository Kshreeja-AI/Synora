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

/**
 * A directed line from one block to another.
 *
 * CYCLES ARE ALLOWED HERE, and are forbidden in a workflow's `dependsOn`.
 * That is not an inconsistency: the workflow rule exists because steps
 * execute in an order, and a cycle would mean a step waiting on itself. A
 * canvas has no execution order — it is a surface for arranging thought,
 * where "A relates to B, which relates back to A" is a thing people
 * genuinely mean. Copying the workflow rule here would be enforcing a
 * constraint past the reason for it.
 *
 * WHAT IS ENFORCED is that a connection always has two real endpoints. A
 * line to a block that no longer exists is drawn from nothing to nothing,
 * so deleting a block deletes its connections rather than leaving them
 * dangling.
 */
export interface CanvasConnection {
  id: string;
  /** Block ids. Both must exist on this canvas. */
  from: string;
  to: string;
  /** Optional text on the line — "then", "because", "blocks". */
  label?: string;
  createdAt: number;
}

export interface CanvasDocument {
  id: string;
  workspaceId: string;
  /**
   * The project this canvas belongs to, if any.
   *
   * A canvas is where arranging happens — the spatial half of thinking a
   * project does — so a project that could hold the conversations but not
   * the canvas would still be missing part of the work. Absent on
   * documents stored before projects could hold canvases, which is why it
   * is optional rather than nullable.
   */
  projectId?: string;
  title: string;
  blocks: CanvasBlock[];
  /** Absent on documents stored before connections existed. */
  connections?: CanvasConnection[];
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
  /** Generous next to maxBlocks, but still finite. */
  maxConnections: 400,
  maxLabelLength: 200,
} as const;
