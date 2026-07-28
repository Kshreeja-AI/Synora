import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import * as planService from '../services/plan.service.js';
import * as subscriptionService from '../services/subscription.service.js';
import * as creditService from '../services/credit.service.js';
import * as invoiceService from '../services/invoice.service.js';
import * as paymentMethodService from '../services/paymentMethod.service.js';
import { NotFoundException } from '@synora/shared';
import { prisma } from '@synora/database';

const router: Router = Router();

// Public: GET /api/billing/plans (list available plans)
router.get('/plans', async (req, res, next) => {
  try {
    const plans = await planService.listActivePlans();
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

// Private: Get the user's workspace for billing operations
async function getUserWorkspace(userId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
  });

  if (!member) {
    throw new NotFoundException('User has no workspaces');
  }

  return member.workspace;
}

// Apply auth middleware to all remaining routes
router.use(authMiddleware);

// GET /api/billing/subscription (get current subscription)
router.get('/subscription', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);
    const subscription = await subscriptionService.getSubscriptionForWorkspace(
      req.userId!,
      workspace.id
    );

    res.json(subscription);
  } catch (error) {
    next(error);
  }
});

// GET /api/billing/credits (get current credit balance)
router.get('/credits', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);
    const balance = await creditService.getCreditBalance(req.userId!, workspace.id);

    res.json({ workspaceId: workspace.id, balance });
  } catch (error) {
    next(error);
  }
});

// GET /api/billing/credit-ledger (get credit ledger entries)
router.get('/credit-ledger', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);
    const entries = await creditService.listCreditLedger(req.userId!, workspace.id);

    res.json(entries);
  } catch (error) {
    next(error);
  }
});

// GET /api/billing/usage (get usage summary)
router.get('/usage', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);
    const usage = await creditService.getUsageSummary(req.userId!, workspace.id);

    res.json(usage);
  } catch (error) {
    next(error);
  }
});

// GET /api/billing/payment-methods (get payment methods)
router.get('/payment-methods', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);
    const paymentMethods = await paymentMethodService.listPaymentMethods(req.userId!, workspace.id);

    res.json(paymentMethods ?? []);
  } catch (error) {
    next(error);
  }
});

// GET /api/billing/invoices (get invoices)
router.get('/invoices', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);
    const invoices = await invoiceService.listInvoices(req.userId!, workspace.id);

    res.json(invoices ?? []);
  } catch (error) {
    next(error);
  }
});

// POST /api/billing/checkout (create checkout session)
router.post('/checkout', async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      planId: z.string(),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    });

    const body = schema.parse(req.body);
    const workspace = await getUserWorkspace(req.userId!);

    // Check if plan exists
    const plan = await planService.getPlan(body.planId);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    // Create checkout session (requires billing provider)
    const session = await subscriptionService.createCheckoutSession(
      req.userId!,
      workspace.id,
      {
        planId: body.planId,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      }
    );

    res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

// POST /api/billing/change-plan (change subscription plan)
router.post('/change-plan', async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      planId: z.string(),
    });

    const body = schema.parse(req.body);
    const workspace = await getUserWorkspace(req.userId!);

    const updatedSubscription = await subscriptionService.changePlan(
      req.userId!,
      workspace.id,
      {
        planId: body.planId,
      }
    );

    res.json(updatedSubscription);
  } catch (error) {
    next(error);
  }
});

// POST /api/billing/cancel (cancel subscription)
router.post('/cancel', async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      atPeriodEnd: z.boolean().optional().default(true),
    });

    const body = schema.parse(req.body);
    const workspace = await getUserWorkspace(req.userId!);

    const canceledSubscription = await subscriptionService.cancelSubscription(
      req.userId!,
      workspace.id,
      { atPeriodEnd: body.atPeriodEnd }
    );

    res.json(canceledSubscription);
  } catch (error) {
    next(error);
  }
});

// POST /api/billing/reactivate (reactivate subscription)
router.post('/reactivate', async (req: AuthRequest, res, next) => {
  try {
    const workspace = await getUserWorkspace(req.userId!);

    const reactivatedSubscription = await subscriptionService.reactivateSubscription(
      req.userId!,
      workspace.id
    );

    res.json(reactivatedSubscription);
  } catch (error) {
    next(error);
  }
});

export default router;
