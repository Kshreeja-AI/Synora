import { prisma } from '@synora/database';
import type { WorkspaceRole } from '@synora/database';
import { ForbiddenException, NotFoundException } from '@synora/shared';
import { createNotification } from './notification.service';
import { requirePermission, requireOwnerForOwnershipChange } from './permissions';
import { recordAuditEvent } from './audit.service';

/**
 * Workspace create/list/get/update, membership listing, and member role
 * management. Reads are membership-checked — a caller who isn't a member
 * gets a 404, never a 403 that would confirm the workspace exists. Writes
 * are checked against the central permission matrix in `./permissions`
 * (never trusted from the client) and, for anything touching ownership,
 * also against `requireOwnerForOwnershipChange`.
 *
 * Every workspace must retain at least one OWNER: `updateMemberRole` and
 * `removeMember` both refuse an action that would leave the workspace
 * without one.
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
  await recordAuditEvent(workspace.id, userId, 'workspace.created', 'workspace', workspace.id, {
    name: workspace.name,
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

export async function requireMembership(
  userId: string,
  workspaceId: string
): Promise<{ id: string; role: WorkspaceRole }> {
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
  requirePermission(membership.role, 'workspace:update');

  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    include: { _count: { select: { members: true } } },
  });

  await recordAuditEvent(workspaceId, userId, 'workspace.updated', 'workspace', workspaceId, input);

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

async function countOwners(workspaceId: string): Promise<number> {
  return prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
}

export async function updateMemberRole(
  actorId: string,
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole
): Promise<WorkspaceMemberSummary> {
  const actorMembership = await requireMembership(actorId, workspaceId);
  requirePermission(actorMembership.role, 'member:role:update');

  const target = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });
  if (!target) {
    throw new NotFoundException('Member');
  }

  requireOwnerForOwnershipChange(actorMembership.role, role === 'OWNER' || target.role === 'OWNER');

  if (target.role === 'OWNER' && role !== 'OWNER' && (await countOwners(workspaceId)) <= 1) {
    throw new ForbiddenException('A workspace must have at least one owner.');
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: memberId },
    data: { role },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });

  await recordAuditEvent(workspaceId, actorId, 'member.role_changed', 'member', target.userId, {
    from: target.role,
    to: role,
  });

  return { id: updated.id, role: updated.role, createdAt: updated.createdAt, user: updated.user };
}

export async function removeMember(actorId: string, workspaceId: string, memberId: string): Promise<void> {
  const actorMembership = await requireMembership(actorId, workspaceId);

  const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
  if (!target) {
    throw new NotFoundException('Member');
  }

  const isSelf = target.userId === actorId;
  if (!isSelf) {
    requirePermission(actorMembership.role, 'member:remove');
    requireOwnerForOwnershipChange(actorMembership.role, target.role === 'OWNER');
  }

  if (target.role === 'OWNER' && (await countOwners(workspaceId)) <= 1) {
    throw new ForbiddenException(
      isSelf
        ? 'You are the last owner. Transfer ownership before leaving this workspace.'
        : 'A workspace must have at least one owner.'
    );
  }

  await prisma.workspaceMember.delete({ where: { id: memberId } });

  await recordAuditEvent(workspaceId, actorId, isSelf ? 'member.left' : 'member.removed', 'member', target.userId, {
    role: target.role,
  });
}
