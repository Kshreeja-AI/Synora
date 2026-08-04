import { prisma } from '@synora/database';
import { getAgent } from '../agents/agent-registry.js';
import { getRun } from '../agents/run-engine.js';
import { getWorkflow } from '../workflows/workflow-registry.js';
import type { CanvasBlock } from './types.js';

/**
 * Turning a link block's stored id into something a person can read.
 *
 * WHY THE ID IS STORED AND THE TITLE IS NOT. A canvas keeps only what a
 * block points AT, never a copy of it. Storing the title at the moment the
 * link was made would produce a canvas that slowly becomes a museum of
 * names things used to have: rename a workflow and the canvas still shows
 * last month's name, with nothing to indicate it is lying. Resolving on
 * read costs a lookup and is always right.
 *
 * WORKSPACE SCOPING IS THE POINT OF THIS FILE, not a detail of it. A block
 * stores a bare id, and nothing stops someone typing an id belonging to
 * another workspace — so every lookup here is filtered by the workspace
 * doing the asking. Without that, a link block would be a way to read the
 * titles of other people's conversations one id at a time.
 *
 * A TARGET THAT CANNOT BE RESOLVED IS REPORTED AS `missing`, WITH NO
 * REASON. Deleted, archived, never existed, or belongs to somebody else
 * all produce the same answer — the same 404-not-403 discipline the routes
 * use, for the same reason: distinguishing them tells an outsider which
 * ids are real.
 */

export interface ResolvedLink {
  blockId: string;
  /** Present when the target resolved. */
  title?: string;
  /** A second line: a run's state, a workflow's step count. */
  detail?: string;
  /**
   * True when the target could not be resolved. Deliberately carries no
   * reason — see the note above.
   */
  missing?: boolean;
}

async function resolveOne(
  block: CanvasBlock,
  workspaceId: string,
): Promise<ResolvedLink> {
  const id = block.targetId;
  if (!id || !block.target) return { blockId: block.id, missing: true };

  switch (block.target) {
    case 'conversation': {
      const conversation = await prisma.conversation.findFirst({
        // Scoped, always. A bare id from another workspace must not
        // resolve into a readable title. A soft-deleted conversation is
        // `missing` too — a link to something someone deleted should read
        // as gone, not as a live thing you cannot open.
        where: { id, workspaceId, status: { not: 'DELETED' } },
        select: { title: true, status: true, lastMessageAt: true },
      });
      if (!conversation) return { blockId: block.id, missing: true };
      const when = conversation.lastMessageAt
        ? `last message ${conversation.lastMessageAt.toISOString().slice(0, 10)}`
        : 'no messages yet';
      return {
        blockId: block.id,
        title: conversation.title,
        detail: conversation.status === 'ARCHIVED' ? `archived · ${when}` : when,
      };
    }
    case 'run': {
      const run = getRun(id, workspaceId);
      if (!run) return { blockId: block.id, missing: true };
      return {
        blockId: block.id,
        title: run.task ? run.task.slice(0, 80) : 'Run',
        // The state is the useful thing about a run at a glance, and it is
        // exactly what goes stale if it were copied onto the block.
        detail: run.state,
      };
    }
    case 'workflow': {
      const workflow = getWorkflow(id, workspaceId);
      if (!workflow) return { blockId: block.id, missing: true };
      return {
        blockId: block.id,
        title: workflow.name,
        detail: `${workflow.steps.length} step${workflow.steps.length === 1 ? '' : 's'}${
          workflow.archived ? ' · archived' : ''
        }`,
      };
    }
    case 'agent': {
      const agent = getAgent(id, workspaceId);
      if (!agent) return { blockId: block.id, missing: true };
      return {
        blockId: block.id,
        title: agent.name,
        detail: agent.archived ? 'archived' : `version ${agent.version}`,
      };
    }
  }
}

/**
 * Resolves every link block on a canvas.
 *
 * Returns one entry per link block, including the ones that did not
 * resolve — a caller needs to be able to tell "this block points at
 * something gone" from "this block was not looked at".
 */
export async function resolveCanvasLinks(
  blocks: CanvasBlock[],
  workspaceId: string,
): Promise<ResolvedLink[]> {
  const links = blocks.filter((b) => b.kind === 'link');
  return Promise.all(links.map((block) => resolveOne(block, workspaceId)));
}
