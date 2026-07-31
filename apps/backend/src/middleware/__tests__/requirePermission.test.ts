import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requirePermission, checkPermission, requireOwnerForOwnershipChange } from '../requirePermission';
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

describe('checkPermission', () => {
  it('should grant all permissions to OWNER', () => {
    const permissions = [
      'workspace:update',
      'workspace:delete',
      'member:invite',
      'billing:manage',
      'conversation:create',
    ] as const;

    permissions.forEach((perm) => {
      expect(checkPermission('OWNER', perm)).toBe(true);
    });
  });

  it('should grant conversation permissions to MEMBER', () => {
    expect(checkPermission('MEMBER', 'conversation:create')).toBe(true);
    expect(checkPermission('MEMBER', 'message:send')).toBe(true);
    expect(checkPermission('MEMBER', 'member:invite')).toBe(false);
  });

  it('should deny all permissions to VIEWER', () => {
    expect(checkPermission('VIEWER', 'conversation:create')).toBe(false);
    expect(checkPermission('VIEWER', 'asset:upload')).toBe(false);
    expect(checkPermission('VIEWER', 'audit:view')).toBe(false);
  });

  it('should grant audit view to ADMIN', () => {
    expect(checkPermission('ADMIN', 'audit:view')).toBe(true);
  });

  it('should not grant billing management to non-OWNER', () => {
    expect(checkPermission('ADMIN', 'billing:manage')).toBe(false);
    expect(checkPermission('EDITOR', 'billing:manage')).toBe(false);
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
