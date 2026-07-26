import { randomBytes } from 'node:crypto';
import { prisma } from '@synora/database';
import type { WorkspaceRole } from '@synora/database';
import { ForbiddenException, NotFoundException, ValidationException } from '@synora/shared';
import { requireMembership } from './workspace.service';
import { requirePermission, requireOwnerForOwnershipChange } from './permissions';
import { recordAuditEvent } from './audit.service';
import { sendWorkspaceInvitationEmail } from '../mail';
import { logger } from '../utils/logger';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InvitationSummary {
  id: string;
  email: string;
  role: WorkspaceRole;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: { id: string; name: string | null; email: string };
}

/** Mail delivery for invitations is best-effort: the invitation row (and its token) is real either way. */
async function sendInviteMailBestEffort(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    logger.warn('[invitations] invitation email failed to send', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createInvitation(
  actorId: string,
  workspaceId: string,
  input: { email: string; role: WorkspaceRole }
): Promise<InvitationSummary> {
  const actorMembership = await requireMembership(actorId, workspaceId);
  requirePermission(actorMembership.role, 'member:invite');
  requireOwnerForOwnershipChange(actorMembership.role, input.role === 'OWNER');

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const existingMembership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
    });
    if (existingMembership) {
      throw new ValidationException('This person is already a member of the workspace.');
    }
  }

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.user.findUniqueOrThrow({ where: { id: actorId } }),
  ]);

  const token = randomBytes(32).toString('hex');
  const invitation = await prisma.workspaceInvitation.upsert({
    where: { workspaceId_email: { workspaceId, email: input.email } },
    create: {
      workspaceId,
      email: input.email,
      role: input.role,
      token,
      invitedById: actorId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
    update: {
      role: input.role,
      token,
      invitedById: actorId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      acceptedAt: null,
      revokedAt: null,
    },
    include: { invitedBy: { select: { id: true, name: true, email: true } } },
  });

  await sendInviteMailBestEffort(() =>
    sendWorkspaceInvitationEmail({
      to: input.email,
      workspaceName: workspace.name,
      inviterName: inviter.name,
      role: input.role,
      token,
    })
  );

  await recordAuditEvent(workspaceId, actorId, 'member.invited', 'invitation', invitation.id, {
    email: input.email,
    role: input.role,
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    invitedBy: invitation.invitedBy,
  };
}

export async function listInvitations(actorId: string, workspaceId: string): Promise<InvitationSummary[]> {
  const actorMembership = await requireMembership(actorId, workspaceId);
  requirePermission(actorMembership.role, 'member:invite');

  const invitations = await prisma.workspaceInvitation.findMany({
    where: { workspaceId, acceptedAt: null, revokedAt: null },
    include: { invitedBy: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    invitedBy: invitation.invitedBy,
  }));
}

export async function revokeInvitation(actorId: string, workspaceId: string, invitationId: string): Promise<void> {
  const actorMembership = await requireMembership(actorId, workspaceId);
  requirePermission(actorMembership.role, 'member:invite');

  const invitation = await prisma.workspaceInvitation.findFirst({ where: { id: invitationId, workspaceId } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new NotFoundException('Invitation');
  }

  await prisma.workspaceInvitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
  await recordAuditEvent(workspaceId, actorId, 'member.invitation_revoked', 'invitation', invitationId, {
    email: invitation.email,
  });
}

export interface InvitationPreview {
  workspaceName: string;
  role: WorkspaceRole;
  email: string;
  invitedBy: string | null;
}

/** No auth required — a valid token is itself the credential to preview (not accept) an invitation. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
    throw new NotFoundException('Invitation');
  }

  return {
    workspaceName: invitation.workspace.name,
    role: invitation.role,
    email: invitation.email,
    invitedBy: invitation.invitedBy.name,
  };
}

export async function acceptInvitation(userId: string, token: string): Promise<{ workspaceId: string }> {
  const invitation = await prisma.workspaceInvitation.findUnique({ where: { token } });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
    throw new NotFoundException('Invitation');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email !== invitation.email) {
    throw new ForbiddenException('This invitation was sent to a different email address.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.upsert({
      where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
      create: { userId, workspaceId: invitation.workspaceId, role: invitation.role },
      update: {},
    });
    await tx.workspaceInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  });

  await recordAuditEvent(invitation.workspaceId, userId, 'member.joined', 'member', userId, {
    via: 'invitation',
    role: invitation.role,
  });

  return { workspaceId: invitation.workspaceId };
}
