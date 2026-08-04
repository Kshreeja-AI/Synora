import { prisma } from '@synora/database';
import { requireMembership } from './checks';

/**
 * What happened in this workspace, told as sentences.
 *
 * THE AUDIT LOG IS THE ONLY SOURCE. Every event here was already being
 * recorded for compliance; this reads the same rows rather than
 * introducing a second event store that would eventually disagree with
 * the first. If it is not in the audit log, it did not happen as far as
 * this feed is concerned — and the fix for a missing event is to record
 * it properly, not to fake it here.
 *
 * WHY EVERY MEMBER MAY READ THIS WHEN `audit:view` IS OWNER/ADMIN-ONLY.
 * The audit log is a governance surface: it includes member management,
 * billing changes, role grants. Restricting that is right. But the
 * consequence was that an ordinary MEMBER had no way at all to answer
 * "what happened here while I was away" — about work they can already
 * see by browsing the lists. So this feed shows a curated ALLOWLIST of
 * work events: things whose outcome is already visible to any member.
 * Governance events stay behind `audit:view`. The line is: this feed may
 * tell you nothing you could not learn by clicking around; it saves the
 * clicking, never widens the access.
 *
 * AN UNKNOWN ACTION IS OMITTED, NOT GUESSED AT. New audit actions appear
 * as the platform grows; showing "did something to something" for one
 * would be noise, and inventing a sentence for it could be wrong. The
 * allowlist is the contract.
 */

/** Work events any member could observe by browsing. Governance excluded. */
const WORK_ACTIONS: Record<string, (meta: Meta) => string> = {
  'conversation_created': (m) => `started the conversation “${str(m, 'title') ?? 'Untitled'}”`,
  'conversation_archived': (m) => `archived the conversation “${str(m, 'title') ?? 'Untitled'}”`,
  'conversation_restored': (m) => `restored the conversation “${str(m, 'title') ?? 'Untitled'}”`,
  'project.created': (m) => `created the project “${str(m, 'name') ?? 'Untitled'}”`,
  'project.updated': (m) => `updated the project “${str(m, 'name') ?? ''}”`.replace(' “”', ''),
  'asset.uploaded': (m) => `uploaded ${str(m, 'name') ?? 'a file'}`,
  'asset.deleted': (m) => `deleted the file ${str(m, 'name') ?? ''}`.trimEnd(),
  'folder.created': (m) => `created the folder “${str(m, 'name') ?? 'Untitled'}”`,
  'folder.renamed': (m) => `renamed a folder to “${str(m, 'name') ?? ''}”`.replace(' to “”', ''),
  'tool.created': (m) => `added the tool ${str(m, 'name') ?? ''}`.trimEnd(),
  'tool.executed': (m) => `ran the tool ${str(m, 'toolName') ?? ''}`.trimEnd(),
  'plugin.tools.synced': () => 'updated a plugin’s tools',
};

type Meta = Record<string, unknown> | null;

function str(meta: Meta, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 120) : undefined;
}

export interface ActivityEntry {
  id: string;
  /** "Priya uploaded quarterly.csv" — the whole point of the feed. */
  sentence: string;
  actor: { id: string; name: string | null } | null;
  action: string;
  targetType: string;
  targetId: string | null;
  at: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function listWorkspaceActivity(
  userId: string,
  workspaceId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<ActivityEntry[]> {
  // Membership only — deliberately NOT audit:view. See the header note.
  await requireMembership(userId, workspaceId);

  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const rows = await prisma.auditLog.findMany({
    where: {
      workspaceId,
      // Filtered in the QUERY, not after: a page of fifty rows that
      // arrived and were then discarded would make page sizes lie.
      action: { in: Object.keys(WORK_ACTIONS) },
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Actor names in one batched lookup. A deleted account reads as
  // "Someone" rather than dropping the row — the event still happened.
  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(actors.map((a) => [a.id, a]));

  return rows.map((row) => {
    const actor = byId.get(row.actorId) ?? null;
    const who = actor?.name || actor?.email || 'Someone';
    const what = WORK_ACTIONS[row.action]!(row.metadata as Meta);
    return {
      id: row.id,
      sentence: `${who} ${what}`,
      actor: actor ? { id: actor.id, name: actor.name } : null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      at: row.createdAt.toISOString(),
    };
  });
}
