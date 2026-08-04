import { prisma } from '@synora/database';
import { NotFoundException, ValidationException } from '@synora/shared';
import { requireMembership } from './workspace.service';
import { requirePermission } from './permissions';
import { recordAuditEvent } from './audit.service';

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
  | 'file'
  | 'document'
  | 'image'
  | 'video'
  | 'audio';

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

  const [conversations, assets, documents, images, videos, audios] = await Promise.all([
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
  ]);

  const entries: ProjectTimelineEntry[] = [
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
  ].sort((a, b) => b.at.localeCompare(a.at));

  const timeline = entries.slice(0, PROJECT_TIMELINE_LIMIT);

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
      file: assets.length,
      document: documents.length,
      image: images.length,
      video: videos.length,
      audio: audios.length,
    },
    timeline,
    // The newest non-archived conversation. Archived ones are excluded
    // because "continue" should not reopen something deliberately put
    // away.
    resumeConversationId: conversations.find((c) => !c.isArchived)?.id ?? null,
    lastActivityAt: timeline[0]?.at ?? null,
  };
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
