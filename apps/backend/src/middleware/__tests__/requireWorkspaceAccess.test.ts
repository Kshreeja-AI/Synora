import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireWorkspaceAccess, requireProjectAccess } from '../requireWorkspaceAccess';
import { NotFoundException } from '@synora/shared';
import { AuthRequest } from '../auth';

// Mock dependencies
vi.mock('../../services/checks', () => ({
  isMember: vi.fn(),
}));

vi.mock('@synora/database', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    folder: {
      findUnique: vi.fn(),
    },
    asset: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('requireWorkspaceAccess middleware', () => {
  let req: Partial<AuthRequest>;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      userId: 'test-user',
      params: { workspaceId: 'workspace-1' },
      path: '/api/workspaces/workspace-1',
      method: 'GET',
    };
    res = {};
    next = vi.fn();
  });

  it('should reject requests without userId', async () => {
    req.userId = undefined;
    const middleware = requireWorkspaceAccess();

    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should reject requests without workspaceId in params', async () => {
    req.params = {};
    const middleware = requireWorkspaceAccess();

    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should allow access when user is workspace member', async () => {
    const { isMember } = await import('../../services/checks');
    vi.mocked(isMember).mockResolvedValueOnce(true);

    const middleware = requireWorkspaceAccess();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(vi.mocked(isMember)).toHaveBeenCalledWith('test-user', 'workspace-1');
  });

  it('should deny access and return 404 when user is not workspace member', async () => {
    const { isMember } = await import('../../services/checks');
    vi.mocked(isMember).mockResolvedValueOnce(false);

    const middleware = requireWorkspaceAccess();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should handle database errors gracefully', async () => {
    const { isMember } = await import('../../services/checks');
    const testError = new Error('Database error');
    vi.mocked(isMember).mockRejectedValueOnce(testError);

    const middleware = requireWorkspaceAccess();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(testError);
  });
});

describe('requireProjectAccess middleware', () => {
  let req: Partial<AuthRequest>;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      userId: 'test-user',
      params: { projectId: 'project-1' },
      path: '/api/projects/project-1',
      method: 'GET',
    };
    res = {};
    next = vi.fn();
  });

  it('should reject requests without userId', async () => {
    req.userId = undefined;
    const middleware = requireProjectAccess();

    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should reject requests without projectId in params', async () => {
    req.params = {};
    const middleware = requireProjectAccess();

    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should allow access when project exists and user is workspace member', async () => {
    const { isMember } = await import('../../services/checks');
    const { prisma } = await import('@synora/database');

    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      workspaceId: 'workspace-1',
    } as any);
    vi.mocked(isMember).mockResolvedValueOnce(true);

    const middleware = requireProjectAccess();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.params?.workspaceId).toBe('workspace-1');
  });

  it('should reject when project does not exist', async () => {
    const { prisma } = await import('@synora/database');
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);

    const middleware = requireProjectAccess();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });

  it('should reject when user is not workspace member', async () => {
    const { isMember } = await import('../../services/checks');
    const { prisma } = await import('@synora/database');

    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      workspaceId: 'workspace-1',
    } as any);
    vi.mocked(isMember).mockResolvedValueOnce(false);

    const middleware = requireProjectAccess();
    await middleware(req as AuthRequest, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
  });
});
