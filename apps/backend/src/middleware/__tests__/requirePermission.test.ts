import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePermission, requireOwnerForOwnershipChange } from '../requirePermission';
import { hasPermission } from '../../services/permissions';
import { ForbiddenException, NotFoundException } from '@synora/shared';
import { AuthRequest } from '../auth';

vi.mock('@synora/database', () => ({
  prisma: {
    workspaceMember: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('hasPermission (centralized matrix from services/permissions.ts)', () => {
  it('should grant all permissions to OWNER', () => {
    const permissions = [
      'workspace:update',
      'workspace:delete',
      'member:invite',
      'billing:manage',
      'conversation:create',
    ] as const;

    permissions.forEach((perm) => {
      expect(hasPermission('OWNER', perm)).toBe(true);
    });
  });

  it('should grant conversation permissions to MEMBER', () => {
    expect(hasPermission('MEMBER', 'conversation:create')).toBe(true);
    expect(hasPermission('MEMBER', 'message:send')).toBe(true);
    expect(hasPermission('MEMBER', 'member:invite')).toBe(false);
  });

  it('should allow MEMBER to upload assets and view billing', () => {
    expect(hasPermission('MEMBER', 'asset:upload')).toBe(true);
    expect(hasPermission('MEMBER', 'billing:view')).toBe(true);
  });

  it('should deny conversation and asset permissions to VIEWER but allow billing:view', () => {
    expect(hasPermission('VIEWER', 'conversation:create')).toBe(false);
    expect(hasPermission('VIEWER', 'asset:upload')).toBe(false);
    expect(hasPermission('VIEWER', 'audit:view')).toBe(false);
    expect(hasPermission('VIEWER', 'billing:view')).toBe(true);
  });

  it('should grant audit view to ADMIN', () => {
    expect(hasPermission('ADMIN', 'audit:view')).toBe(true);
  });

  it('should not grant billing management to non-OWNER', () => {
    expect(hasPermission('ADMIN', 'billing:manage')).toBe(false);
    expect(hasPermission('EDITOR', 'billing:manage')).toBe(false);
  });

  it('should not grant project:create to MEMBER', () => {
    expect(hasPermission('MEMBER', 'project:create')).toBe(false);
    expect(hasPermission('EDITOR', 'project:create')).toBe(true);
    expect(hasPermission('ADMIN', 'project:create')).toBe(true);
  });
});

describe('requirePermission middleware', () => {
  let req: Partial<AuthRequest>;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      userId: 'test-user',
      params: { workspaceId: 'workspace-1' },
      path: '/api/workspaces/workspace-1/members',
      method: 'POST',
      body: { email: 'user@example.com', role: 'ADMIN' },
    };
    res = {};
    next = vi.fn();
  });

  it('should reject requests without userId or workspaceId', async () => {
    req.userId = undefined;
    const middleware = requirePermission('member:invite');

    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should allow request when user has required permission', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValueOnce({
      role: 'OWNER',
    } as any);

    const middleware = requirePermission('member:invite');
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.userRole).toBe('OWNER');
  });

  it('should deny request when user lacks required permission', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValueOnce({
      role: 'VIEWER',
    } as any);

    const middleware = requirePermission('member:invite');
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should deny request for non-members', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValueOnce(null);

    const middleware = requirePermission('member:invite');
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });
});

describe('requireOwnerForOwnershipChange middleware', () => {
  let req: Partial<AuthRequest>;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      userId: 'owner-user',
      params: { workspaceId: 'workspace-1', memberId: 'member-1' },
      body: { role: 'ADMIN' },
      path: '/api/workspaces/workspace-1/members/member-1',
      method: 'PATCH',
    };
    res = {};
    next = vi.fn();
  });

  it('should allow role change when requester is OWNER', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.workspaceMember.findUnique)
      .mockResolvedValueOnce({ role: 'MEMBER' } as any) // target member
      .mockResolvedValueOnce({ role: 'OWNER' } as any); // requester

    const middleware = requireOwnerForOwnershipChange();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('should deny role change when non-owner tries to change ownership', async () => {
    const { prisma } = await import('@synora/database');
    req.body = { role: 'OWNER' };

    vi.mocked(prisma.workspaceMember.findUnique)
      .mockResolvedValueOnce({ role: 'MEMBER' } as any) // target member
      .mockResolvedValueOnce({ role: 'ADMIN' } as any); // requester (not owner)

    const middleware = requireOwnerForOwnershipChange();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('should prevent removing the last OWNER', async () => {
    const { prisma } = await import('@synora/database');
    req.body = { role: 'ADMIN' };

    vi.mocked(prisma.workspaceMember.findUnique)
      .mockResolvedValueOnce({ role: 'OWNER' } as any) // target member (OWNER)
      .mockResolvedValueOnce({ role: 'OWNER' } as any); // requester (OWNER)

    vi.mocked(prisma.workspaceMember.count).mockResolvedValueOnce(1); // Only one OWNER

    const middleware = requireOwnerForOwnershipChange();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('should pass through non-ownership-related changes', async () => {
    const middleware = requireOwnerForOwnershipChange();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});
