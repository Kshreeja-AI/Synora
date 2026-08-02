import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requireAdminRole } from '../middleware/requireAdminRole.js';
import { NotFoundException } from '@synora/shared';
import * as planService from '../services/plan.service.js';
import * as creditService from '../services/credit.service.js';

const router: Router = Router();

router.use(authMiddleware);
router.use(requireAdminRole);

// GET /api/admin/plans
router.get('/plans', async (req: AuthRequest, res, next) => {
  try {
    const plans = await planService.listAllPlans();
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/plans
router.post('/plans', async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      key: z.string(),
      name: z.string(),
      interval: z.enum(['MONTH', 'YEAR']),
      priceCents: z.number(),
      creditsPerInterval: z.number().optional(),
      trialDays: z.number().optional(),
      features: z.record(z.unknown()).optional(),
      sortOrder: z.number().optional(),
    });

    const input = schema.parse(req.body);
    const plan = await planService.createPlan(req.userId!, input);

    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/plans/:planId
router.patch('/plans/:planId', async (req: AuthRequest, res, next) => {
  try {
    const planId = req.params.planId;

    const schema = z.object({
      name: z.string().optional(),
      priceCents: z.number().optional(),
      creditsPerInterval: z.number().optional(),
      trialDays: z.number().optional(),
      features: z.record(z.unknown()).optional(),
      sortOrder: z.number().optional(),
    });

    const input = schema.parse(req.body);
    const plan = await planService.updatePlan(req.userId!, planId, input);

    res.json(plan);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/plans/:planId/archive
router.post('/plans/:planId/archive', async (req: AuthRequest, res, next) => {
  try {
    const planId = req.params.planId;
    const plan = await planService.archivePlan(req.userId!, planId);

    res.json(plan);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/plans/:planId/set-default
router.post('/plans/:planId/set-default', async (req: AuthRequest, res, next) => {
  try {
    const planId = req.params.planId;
    const plan = await planService.setDefaultPlan(req.userId!, planId);

    res.json(plan);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/billing/past-due
// Surfaces workspaces currently failing payment, ordered longest-struggling
// first, so support can proactively reach out. There is no automatic
// suspension/downgrade of a PAST_DUE workspace — Stripe's own dunning
// retries run independently, and this gives a human the visibility to
// intervene without racing that process.
router.get('/billing/past-due', async (req: AuthRequest, res, next) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { status: 'PAST_DUE' },
      include: {
        plan: { select: { name: true, priceCents: true } },
        workspace: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { pastDueSince: 'asc' },
    });

    res.json(
      subscriptions.map((s) => ({
        workspaceId: s.workspace.id,
        workspaceName: s.workspace.name,
        workspaceSlug: s.workspace.slug,
        planName: s.plan.name,
        pastDueSince: s.pastDueSince,
        paymentFailureCount: s.paymentFailureCount,
      })),
    );
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/workspaces/:workspaceId/billing
router.get('/workspaces/:workspaceId/billing', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.workspaceId;

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException('Workspace');
    }

    const [subscription, credits, recentInvoices, recentLedgerEntries] = await Promise.all([
      prisma.subscription.findUnique({
        where: { workspaceId },
        include: { plan: true },
      }),
      prisma.workspaceCredits.findUnique({ where: { workspaceId } }),
      prisma.invoice.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.creditLedgerEntry.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    res.json({
      workspaceId,
      subscription,
      creditBalance: credits?.balance ?? null,
      recentInvoices,
      recentLedgerEntries,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/workspaces/:workspaceId/credits/grant
router.post('/workspaces/:workspaceId/credits/grant', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.workspaceId;

    const schema = z.object({
      amount: z.number(),
      reason: z.string(),
    });

    const input = schema.parse(req.body);
    const credits = await creditService.grantCredits(req.userId!, workspaceId, input);

    res.json(credits);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/workspaces/:workspaceId/credits/adjust
router.post('/workspaces/:workspaceId/credits/adjust', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.workspaceId;

    const schema = z.object({
      amount: z.number(),
      reason: z.string(),
    });

    const input = schema.parse(req.body);
    const credits = await creditService.adjustCredits(req.userId!, workspaceId, input);

    res.json(credits);
  } catch (error) {
    next(error);
  }
});

export default router;
