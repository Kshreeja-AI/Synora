import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireAdminRole } from '../middleware/requireAdminRole';
import { createApiResponse } from '@synora/shared';
import { logger } from '../utils/logger';

/**
 * Admin API — read-only oversight surface for platform operators.
 *
 * These endpoints are separate from adminBilling.ts, which owns write actions
 * against the billing subsystem. Everything here is read-only by design:
 * writes should either be self-service (via the workspace's own routes) or
 * go through an explicit, audited billing action. Bulk destructive admin
 * writes are a separate follow-up.
 *
 * Every route is behind (authMiddleware, requireAdminRole) — non-admins get
 * 403 before the handler runs.
 */
const router: Router = Router();

router.use(authMiddleware);
router.use(requireAdminRole);

/**
 * GET /api/admin/stats — cross-workspace counters for the admin overview.
 *
 * Backed by cheap SQL COUNTs — safe to poll from a dashboard, but not a
 * substitute for the Prometheus metrics endpoint (/metrics) which observers
 * scrape for time series and alerting.
 */
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  const [
    totalUsers,
    activeUsers,
    totalWorkspaces,
    totalConversations,
    totalMessages,
    activeSubscriptions,
    last24hMessages,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.workspace.count(),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'TRIAL'] } } }).catch(() => 0),
    prisma.message.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  res.json(
    createApiResponse({
      totalUsers,
      activeUsers,
      totalWorkspaces,
      totalConversations,
      totalMessages,
      activeSubscriptions,
      last24hMessages,
    })
  );
});

const listUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * GET /api/admin/users — paginated user directory with search and filters.
 *
 * Never returns password hashes, refresh tokens, or session data. Zod parses
 * the query so admins can't sneak arbitrary Prisma filters into it.
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  const params = listUsersQuerySchema.parse(req.query);
  const where = {
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' as const } },
            { name: { contains: params.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        _count: { select: { workspaces: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json(createApiResponse({ users, total }));
});

const listWorkspacesQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/** GET /api/admin/workspaces — paginated workspace directory. */
router.get('/workspaces', async (req: AuthRequest, res: Response) => {
  const params = listWorkspacesQuerySchema.parse(req.query);
  const where = params.search
    ? {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' as const } },
          { slug: { contains: params.search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [workspaces, total] = await Promise.all([
    prisma.workspace.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      select: {
        id: true,
        name: true,
        slug: true,
        avatar: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            conversations: true,
            projects: true,
          },
        },
      },
    }),
    prisma.workspace.count({ where }),
  ]);

  res.json(createApiResponse({ workspaces, total }));
});

const listAuditLogsQuerySchema = z.object({
  workspaceId: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * GET /api/admin/audit-logs — cross-workspace audit trail.
 *
 * The workspace-scoped route (routes/workspaces.ts) can only see one
 * workspace at a time. Admins need to search across all of them, which is
 * this route's job.
 */
router.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  const params = listAuditLogsQuerySchema.parse(req.query);
  const where = {
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
    ...(params.action ? { action: { contains: params.action } } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json(createApiResponse({ logs, total }));
});

/**
 * POST /api/admin/users/:userId/suspend — soft-suspend a user account.
 *
 * The only write in this file, and gated: cannot suspend another admin
 * (prevents lockout races between operators) or yourself.
 */
router.post('/users/:userId/suspend', async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const actorId = req.user!.id;

  if (userId === actorId) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'INVALID', message: 'Cannot suspend your own account' } });
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target) {
    return res
      .status(404)
      .json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
  }
  if (target.role === 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Cannot suspend another admin' },
    });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED' },
    select: { id: true, email: true, status: true },
  });

  logger.warn('[admin] User suspended', { userId, actorId });
  return res.json(createApiResponse(updated));
});

/** POST /api/admin/users/:userId/reactivate — undo a suspension. */
router.post('/users/:userId/reactivate', async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const actorId = req.user!.id;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE' },
    select: { id: true, email: true, status: true },
  });

  logger.info('[admin] User reactivated', { userId, actorId });
  res.json(createApiResponse(updated));
});

export default router;
