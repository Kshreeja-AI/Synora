import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import {
  createWorkspace,
  listWorkspacesForUser,
  listWaitingElsewhere,
  getWorkspaceForUser,
  updateWorkspace,
  listWorkspaceMembers,
  updateMemberRole,
  removeMember,
} from '../services/workspace.service';
import { createInvitation, listInvitations, revokeInvitation } from '../services/invitation.service';
import { listAuditLog } from '../services/audit.service';

const router: Router = Router();

const parseOptionalDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value as string);
  return isNaN(date.getTime()) ? undefined : date;
};

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'EDITOR', 'MEMBER', 'VIEWER']),
});

const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'MEMBER', 'VIEWER']),
});

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const workspaces = await listWorkspacesForUser(req.userId!);
    res.json(createApiResponse(workspaces));
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = createWorkspaceSchema.parse(req.body);
    const workspace = await createWorkspace(req.userId!, input);
    res.status(201).json(createApiResponse(workspace));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/waiting-elsewhere — per-workspace counts of
// decisions waiting on the signed-in person across ALL their
// workspaces. Registered BEFORE /:id so "waiting-elsewhere" is never
// read as a workspace id. Self-scoped: it starts from the caller's own
// memberships.
router.get('/waiting-elsewhere', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const entries = await listWaitingElsewhere(req.userId!);
    res.json(createApiResponse(entries));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getWorkspaceForUser(req.userId!, req.params.id);
    res.json(createApiResponse(workspace));
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = updateWorkspaceSchema.parse(req.body);
    const workspace = await updateWorkspace(req.userId!, req.params.id, input);
    res.json(createApiResponse(workspace));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/members', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const members = await listWorkspaceMembers(req.userId!, req.params.id);
    res.json(createApiResponse(members));
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/members/:memberId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { role } = updateMemberRoleSchema.parse(req.body);
    const member = await updateMemberRole(req.userId!, req.params.id, req.params.memberId, role);
    res.json(createApiResponse(member));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/members/:memberId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    await removeMember(req.userId!, req.params.id, req.params.memberId);
    res.json(createApiResponse({ message: 'Member removed.' }));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/invitations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const invitations = await listInvitations(req.userId!, req.params.id);
    res.json(createApiResponse(invitations));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/invitations', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const input = createInvitationSchema.parse(req.body);
    const invitation = await createInvitation(req.userId!, req.params.id, input);
    res.status(201).json(createApiResponse(invitation));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/invitations/:invitationId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    await revokeInvitation(req.userId!, req.params.id, req.params.invitationId);
    res.json(createApiResponse({ message: 'Invitation revoked.' }));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/audit-log', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const before = parseOptionalDate(req.query.before);
    const logs = await listAuditLog(req.userId!, req.params.id, { before });
    res.json(createApiResponse(logs));
  } catch (error) {
    next(error);
  }
});

export default router;
