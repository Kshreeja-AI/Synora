import { prisma } from '@synora/database';
import { NotFoundException, ValidationException } from '@synora/shared';
import { requireMembership } from './workspace.service';
import { requirePermission } from './permissions';
import { recordAuditEvent } from './audit.service';
import { listCanvasesForProject } from '../canvas/canvas-store';
import { listRuns } from '../agents/run-engine';
import { getAgent } from '../agents/agent-registry';
import { getWorkflow } from '../workflows/workflow-registry';

/**
 * A project, seen as the work inside it rather than as a row.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. A project could hold files, folders
 * and generated media — and nothing else. The conversations where the
 * thinking actually happened lived somewhere else entirely, so opening a
 * project told you what had been produced but never how, or why, or what
 * was still unfinished. People answered that by keeping it in their heads
 * and re-explaining it to the AI every time. This assembles the whole
 * picture in one read.
 *
 * ONE CALL, NOT SIX. The page needs conversations, files, folders and
 * outputs together; six round trips would make the project page slower
 * than the sum of its parts and would show it filling in piecemeal, which
 * reads as broken rather than as loading.
 *
 * THE TIMELINE IS ASSEMBLED, NOT STORED. Every item already carries a
 * timestamp, so a chronology is a sort rather than a new source of truth
 * that could disagree with the things it describes. Nothing is written to
 * produce it, which also means it cannot drift.
 *
 * WHAT IS DELIBERATELY NOT HERE: any judgement about whether the project
 * is going well. "Last touched three weeks ago" is a fact the person can
 * interpret; "this project is stalled" is the platform deciding something
 * about their work that it has no standing to decide.
 */

export type ProjectItemKind =
  | 'conversation'
  | 'canvas'
  | 'file'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'agentRun'
  | 'note';

export interface ProjectTimelineEntry {
  kind: ProjectItemKind;
  id: string;
  title: string;
  /** When it last changed — what "recent" means to a person. */
  at: string;
  /** A second line, when there is a useful fact rather than filler. */
  detail?: string;
}

export interface ProjectWorkspace {
  project: {
    id: string;
    name: string;
    description: string | null;
    goal: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  counts: Record<ProjectItemKind, number>;
  /** Newest first: what someone wants when returning to a project. */
  timeline: ProjectTimelineEntry[];
  /**
   * The most recent conversation, if any — the "continue where I left
   * off" answer. Named rather than left for the caller to derive, so
   * every surface agrees on what continuing means.
   */
  resumeConversationId: string | null;
  /** Facts, not judgements. */
  lastActivityAt: string | null;
  /**
   * What's new since this person was last here — the "continue months
   * later without starting from zero" answer. Null on a first-ever visit,
   * since there is no previous timestamp to compare against; a returning
   * visit always gets one, even when its count is zero, because "nothing
   * changed since you were last here" is itself a fact worth being able
   * to state plainly rather than a case indistinguishable from "never
   * been here before."
   */
  newSinceLastVisit: ProjectVisitDigest | null;
  /**
   * The decision log, whole. Distinct from the merged timeline for two
   * reasons a decisions reader cares about: content is FULL and verbatim
   * (the timeline truncates titles to 80 chars), and a busy project's
   * other activity can crowd old notes out of the timeline's cap — the
   * log must not shrink because someone uploaded files. Newest first.
   */
  decisions: ProjectDecision[];
}

export interface ProjectDecision {
  id: string;
  /** Exactly as typed — never summarised, corrected, or reworded. */
  content: string;
  author: string | null;
  at: string;
  /** This note corrects an earlier one. */
  correction: boolean;
  /** A later note corrects this one. It stays readable, marked. */
  correctedLater: boolean;
}

export interface ProjectVisitDigest {
  /** The visit this is measured since — not the one just recorded. */
  previousVisitAt: string;
  count: number;
  byKind: Partial<Record<ProjectItemKind, number>>;
}

/** How many entries a timeline returns. Bounded like every other list. */
export const PROJECT_TIMELINE_LIMIT = 100;

function iso(value: Date): string {
  return value.toISOString();
}

export async function getProjectWorkspace(
  userId: string,
  projectId: string,
): Promise<ProjectWorkspace> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundException('Project');
  // Membership is re-checked here and not merely trusted from the route
  // guard: a service that assumes it was called correctly is one refactor
  // away from being called incorrectly.
  if (!project.workspaceId) throw new NotFoundException('Project');
  await requireMembership(userId, project.workspaceId);

  const [conversations, assets, documents, images, videos, audios, previousVisit, notes] =
    await Promise.all([
      prisma.conversation.findMany({
        where: { projectId, status: { not: 'DELETED' } },
        select: { id: true, title: true, updatedAt: true, lastMessageAt: true, isArchived: true },
        orderBy: { updatedAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
      prisma.asset.findMany({
        where: { projectId },
        select: { id: true, name: true, createdAt: true, mimeType: true, size: true },
        orderBy: { createdAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
      prisma.document.findMany({
        where: { projectId },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
      prisma.generatedImage.findMany({
        where: { projectId },
        select: { id: true, prompt: true, createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
      prisma.generatedVideo.findMany({
        where: { projectId },
        select: { id: true, prompt: true, createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
      prisma.generatedAudio.findMany({
        where: { projectId },
        select: { id: true, prompt: true, createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
      // Read BEFORE this visit is recorded — the digest below must be
      // measured against the LAST visit, not this one, or "what's new"
      // would always be empty (comparing a moment to itself).
      prisma.projectVisit.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { lastViewedAt: true },
      }),
      prisma.projectNote.findMany({
        where: { projectId },
        select: { id: true, userId: true, content: true, createdAt: true, correctsNoteId: true },
        orderBy: { createdAt: 'desc' },
        take: PROJECT_TIMELINE_LIMIT,
      }),
    ]);

  // Which notes have been corrected by a LATER note. The original is
  // never edited — it is marked, so a reader neither acts on stale
  // rationale nor loses what was believed at the time.
  const correctedNoteIds = new Set(
    notes.map((n) => n.correctsNoteId).filter((id): id is string => id !== null),
  );

  // A note's author is resolved by a separate lookup rather than a Prisma
  // relation on ProjectNote — the same choice made for agent/workflow names
  // on run entries below: one batched query, not one join per note.
  const noteAuthors = notes.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(notes.map((n) => n.userId))] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const authorNameById = new Map(noteAuthors.map((u) => [u.id, u.name ?? u.email]));

  // Canvases live in a file-backed store rather than the database, so
  // they are read separately and merged into the same chronology. The
  // timeline is a view over several sources by design — which is exactly
  // why it is assembled rather than stored.
  const canvases = listCanvasesForProject(project.workspaceId, projectId).filter(
    (c) => !c.archived,
  );

  // Agent (and workflow) runs live in the same in-memory/file-backed run
  // store as canvases, not the database — filed the same way and read
  // the same way, one more source merged into the one chronology.
  const runs = listRuns(project.workspaceId, { projectId });

  const entries: ProjectTimelineEntry[] = [
    ...canvases.map((c) => ({
      kind: 'canvas' as const,
      id: c.id,
      title: c.title,
      at: new Date(c.updatedAt).toISOString(),
      detail: `${c.blocks.length} block${c.blocks.length === 1 ? '' : 's'}`,
    })),
    ...conversations.map((c) => ({
      kind: 'conversation' as const,
      id: c.id,
      title: c.title,
      at: iso(c.lastMessageAt ?? c.updatedAt),
      detail: c.isArchived ? 'archived' : undefined,
    })),
    ...assets.map((a) => ({
      kind: 'file' as const,
      id: a.id,
      title: a.name,
      at: iso(a.createdAt),
      detail: `${a.mimeType} · ${Math.max(1, Math.round(a.size / 1024))} KB`,
    })),
    ...documents.map((d) => ({
      kind: 'document' as const,
      id: d.id,
      title: d.title,
      at: iso(d.updatedAt),
    })),
    // Media titles come from the prompt that produced them, truncated: a
    // prompt is what the person actually recognises it by, and the whole
    // thing would be a paragraph in a list.
    ...images.map((i) => ({
      kind: 'image' as const,
      id: i.id,
      title: i.prompt.slice(0, 80),
      at: iso(i.createdAt),
      detail: i.status,
    })),
    ...videos.map((v) => ({
      kind: 'video' as const,
      id: v.id,
      title: v.prompt.slice(0, 80),
      at: iso(v.createdAt),
      detail: v.status,
    })),
    ...audios.map((a) => ({
      kind: 'audio' as const,
      id: a.id,
      title: a.prompt.slice(0, 80),
      at: iso(a.createdAt),
      detail: a.status,
    })),
    // Task is what the person actually typed, so it — not the agent's
    // name — is the title; the agent (or workflow) is context, in the
    // detail line. Agents and workflows execute through the same run
    // record, and `r.agentId` names whichever definition actually ran —
    // an agent's own id space (`agent_...`) never collides with a
    // workflow's (`wf_...`), so trying both lookups is safe and correct
    // rather than assuming every run in this store came from an agent.
    ...runs.map((r) => {
      const agent = getAgent(r.agentId, r.workspaceId);
      const workflow = agent ? null : getWorkflow(r.agentId, r.workspaceId);
      return {
        kind: 'agentRun' as const,
        id: r.id,
        title: r.task.slice(0, 80),
        at: iso(new Date(r.finishedAt ?? r.createdAt)),
        detail: `${agent?.name ?? workflow?.name ?? 'agent'} · ${r.state.replace('_', ' ')}`,
      };
    }),
    // A person's own record of why a decision was made — content shown
    // exactly as written, never summarised or reworded, so the timeline
    // never implies an AI produced a rationale nobody actually stated.
    ...notes.map((n) => {
      const author = authorNameById.get(n.userId);
      // The original stays visible, marked — a reader must neither act
      // on stale rationale nor lose what was believed at the time.
      const status = correctedNoteIds.has(n.id)
        ? 'corrected by a later note'
        : n.correctsNoteId
          ? 'correction'
          : undefined;
      return {
        kind: 'note' as const,
        id: n.id,
        title: n.content.slice(0, 80),
        at: iso(n.createdAt),
        detail: status ? `${author ?? 'Someone'} · ${status}` : author,
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const timeline = entries.slice(0, PROJECT_TIMELINE_LIMIT);

  // Measured against ALL matching entries, not just the timeline page
  // shown above — a digest that undercounted because a busy project's
  // timeline got truncated first would be quietly wrong rather than
  // honestly bounded.
  const previousVisitAt = previousVisit ? iso(previousVisit.lastViewedAt) : null;
  const newSinceLastVisit: ProjectVisitDigest | null = previousVisitAt
    ? (() => {
        const since = entries.filter((e) => e.at > previousVisitAt);
        const byKind: Partial<Record<ProjectItemKind, number>> = {};
        for (const e of since) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
        return { previousVisitAt, count: since.length, byKind };
      })()
    : null;

  // Recorded AFTER the digest is computed, so this visit is never
  // measured against itself, and only once the read has actually
  // succeeded — a membership check that throws above must not silently
  // consume the person's "last visit" on a request that never showed
  // them anything.
  await prisma.projectVisit.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId },
    update: { lastViewedAt: new Date() },
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      goal: project.goal,
      status: project.status,
      createdAt: iso(project.createdAt),
      updatedAt: iso(project.updatedAt),
    },
    counts: {
      conversation: conversations.length,
      canvas: canvases.length,
      file: assets.length,
      document: documents.length,
      image: images.length,
      video: videos.length,
      audio: audios.length,
      agentRun: runs.length,
      note: notes.length,
    },
    timeline,
    // The newest non-archived conversation. Archived ones are excluded
    // because "continue" should not reopen something deliberately put
    // away.
    resumeConversationId: conversations.find((c) => !c.isArchived)?.id ?? null,
    lastActivityAt: timeline[0]?.at ?? null,
    newSinceLastVisit,
    // Already fetched above — the log is a re-shaping, not a new query.
    decisions: notes.map((n) => ({
      id: n.id,
      content: n.content,
      author: authorNameById.get(n.userId) ?? null,
      at: iso(n.createdAt),
      correction: n.correctsNoteId !== null,
      correctedLater: correctedNoteIds.has(n.id),
    })),
  };
}

/**
 * Adding a decision note to a project.
 *
 * WHY THIS IS DELIBERATELY MINIMAL. Recording why a decision was made is
 * only useful if it costs almost nothing to do in the moment — a form
 * with fields for context, alternatives considered and a category would
 * be filled in accurately only in retrospect, by which point the
 * reasoning is already half-forgotten. One text field, timestamped and
 * attributed automatically, is the version a person will actually use.
 *
 * CONTENT IS NEVER REWRITTEN. What is stored is exactly what was typed,
 * shown later exactly as written — never summarised, corrected, or
 * reinterpreted by anything. A note is someone's own record of their own
 * reasoning; changing its wording would quietly make it someone else's.
 */
export async function addProjectNote(
  userId: string,
  projectId: string,
  content: string,
  correctsNoteId?: string,
): Promise<{ id: string; createdAt: string }> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundException('Project');
  if (!project.workspaceId) throw new NotFoundException('Project');
  await requireMembership(userId, project.workspaceId);

  const trimmed = content.trim();
  if (!trimmed) throw new ValidationException('note content cannot be empty');

  // A correction target is a claim, so it is verified: the note must
  // exist IN THIS PROJECT. Same-shaped 404 as every other cross-boundary
  // probe — whether it exists elsewhere is not this caller's to learn.
  if (correctsNoteId) {
    const target = await prisma.projectNote.findFirst({
      where: { id: correctsNoteId, projectId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Note');
  }

  const note = await prisma.projectNote.create({
    data: { projectId, userId, content: trimmed, correctsNoteId: correctsNoteId ?? null },
    select: { id: true, createdAt: true },
  });
  return { id: note.id, createdAt: iso(note.createdAt) };
}

/**
 * Turning a conversation into a project.
 *
 * WHY THIS EXISTS AS ONE ACTION. Work does not start as a project. It
 * starts as a question, and somewhere in the middle a person realises the
 * thing they are doing is bigger than the thread they are doing it in.
 * Making them stop, leave, go to another page, create a project, come
 * back, and file the conversation is six steps to record one realisation
 * — and the cost is paid exactly when their attention is most valuable.
 *
 * WHY IT IS ONE TRANSACTION. Creating the project and filing the
 * conversation are halves of a single intention. If the second failed on
 * its own, the person would be left with an empty project they did not ask
 * for and a conversation still sitting outside it, which is worse than
 * having failed cleanly.
 *
 * THE NAME DEFAULTS TO THE CONVERSATION'S TITLE rather than asking. The
 * conversation already has a name the person chose or accepted, it is
 * almost always the right one, and renaming a project later is trivial —
 * so a dialog here would be a question whose answer is already known.
 */
export async function promoteConversationToProject(
  userId: string,
  workspaceId: string,
  conversationId: string,
  name?: string,
): Promise<{ projectId: string; name: string }> {
  const membership = await requireMembership(userId, workspaceId);
  // The same permission a directly-created project needs. Promoting must
  // not be a way around a control that creating respects.
  requirePermission(membership.role, 'project:create');

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: { id: true, title: true, projectId: true },
  });
  if (!conversation) throw new NotFoundException('Conversation');
  if (conversation.projectId) {
    throw new ValidationException('this conversation is already in a project');
  }

  const projectName = (name ?? conversation.title).trim().slice(0, 200) || 'Untitled project';

  // An INTERACTIVE transaction, because the second statement needs the id
  // the first one generates. A batch array cannot express that dependency,
  // and doing the update outside the transaction would leave the failure
  // this whole function exists to prevent: an empty project nobody asked
  // for, beside a conversation still outside it.
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { userId, workspaceId, name: projectName },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { projectId: created.id },
    });
    return created;
  });

  await recordAuditEvent(workspaceId, userId, 'project.created', 'project', project.id, {
    name: project.name,
    promotedFromConversation: conversationId,
  });

  return { projectId: project.id, name: project.name };
}

/**
 * FILING AN EXISTING CONVERSATION INTO AN EXISTING PROJECT DELIBERATELY
 * LIVES ELSEWHERE —
 * `conversation.service.update`, alongside renaming and re-tagging it.
 * Filing is an edit to the conversation, not an operation on the project,
 * and giving it a second home here would have meant two places enforcing
 * the same "project must be in the same workspace" rule. Two copies of a
 * security rule eventually disagree.
 */
