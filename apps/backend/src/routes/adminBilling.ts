import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requireAdminRole } from '../middleware/requireAdminRole.js';
import * as planService from '../services/plan.service.js';
import * as creditService from '../services/credit.service.js';
import { createApiResponse } from '@synora/shared';

const router: Router = Router();

router.use(authMiddleware);
router.use(requireAdminRole);

// GET /api/admin/plans
router.get('/plans', async (req: AuthRequest, res, next) => {
  try {
    const plans = await planService.listAllPlans();
    res.json(createApiResponse(plans));
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

    res.status(201).json(createApiResponse(plan));
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

    res.json(createApiResponse(plan));
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/plans/:planId/archive
router.post('/plans/:planId/archive', async (req: AuthRequest, res, next) => {
  try {
    const planId = req.params.planId;
    const plan = await planService.archivePlan(req.userId!, planId);

    res.json(createApiResponse(plan));
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/plans/:planId/set-default
router.post('/plans/:planId/set-default', async (req: AuthRequest, res, next) => {
  try {
    const planId = req.params.planId;
    const plan = await planService.setDefaultPlan(req.userId!, planId);

    res.json(createApiResponse(plan));
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/workspaces/:workspaceId/billing
router.get('/workspaces/:workspaceId/billing', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.workspaceId;

    // Placeholder: in production, compose subscription + credits + recent invoices
    res.json(createApiResponse({ workspaceId, message: 'Support view not yet implemented' }));
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

    res.json(createApiResponse(credits));
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

    res.json(createApiResponse(credits));
  } catch (error) {
    next(error);
  }
});

export default router;
