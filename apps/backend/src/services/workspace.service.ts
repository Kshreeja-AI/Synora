import { prisma } from '@synora/database';
import type { WorkspaceRole } from '@synora/database';
import { ForbiddenException, NotFoundException } from '@synora/shared';
import { createNotification } from './notification.service';

/**
 * Workspace create/list/get/update, and the read-only member listing that
 * backs the workspace settings page. Reads are membership-checked — a
 * caller who isn't a member gets a 404, never a 403 that would confirm the
 * workspace exists. Writes additionally require the OWNER role; a member
 * who isn't the owner gets a 403 (they already know the workspace exists).
 *
 * Invitations, additional roles, and member management are out of scope
 * here (see NEXT_TASK.md) — this only covers create/list/get/rename and
 * OWNER-on-create.
 */

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  role: WorkspaceRole;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMemberSummary {
  id: string;
  role: WorkspaceRole;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'workspace';
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;

  // Practically bounded: collisions require another workspace with the
  // exact same slugified name, so this loop terminates almost immediately.
  while (await prisma.workspace.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function createWorkspace(
  userId: string,
  input: { name: string; description?: string }
): Promise<WorkspaceSummary> {
  const slug = await generateUniqueSlug(input.name);

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        members: {
          create: { userId, role: 'OWNER' },
        },
      },
      include: { _count: { select: { members: true } } },
    });
    return created;
  });

  await createNotification(userId, {
    type: 'WORKSPACE',
    title: 'Workspace created',
    body: `"${workspace.name}" is ready to go.`,
    link: `/dashboard/settings/workspace`,
  });

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    avatar: workspace.avatar,
    role: 'OWNER',
    memberCount: workspace._count.members,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: { include: { _count: { select: { members: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    slug: membership.workspace.slug,
    description: membership.workspace.description,
    avatar: membership.workspace.avatar,
    role: membership.role,
    memberCount: membership.workspace._count.members,
    createdAt: membership.workspace.createdAt,
    updatedAt: membership.workspace.updatedAt,
  }));
}

async function requireMembership(
  userId: string,
  workspaceId: string
): Promise<{ role: WorkspaceRole }> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });

  if (!membership) {
    throw new NotFoundException('Workspace');
  }

  return membership;
}

export async function getWorkspaceForUser(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
  const membership = await requireMembership(userId, workspaceId);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { _count: { select: { members: true } } },
  });

  if (!workspace) {
    throw new NotFoundException('Workspace');
  }

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    avatar: workspace.avatar,
    role: membership.role,
    memberCount: workspace._count.members,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  input: { name?: string; description?: string }
): Promise<WorkspaceSummary> {
  const membership = await requireMembership(userId, workspaceId);

  if (membership.role !== 'OWNER') {
    throw new ForbiddenException('Only the workspace owner can update workspace settings.');
  }

  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    include: { _count: { select: { members: true } } },
  });

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    avatar: workspace.avatar,
    role: membership.role,
    memberCount: workspace._count.members,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function listWorkspaceMembers(
  userId: string,
  workspaceId: string
): Promise<WorkspaceMemberSummary[]> {
  await requireMembership(userId, workspaceId);

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((member) => ({
    id: member.id,
    role: member.role,
    createdAt: member.createdAt,
    user: member.user,
  }));
}
