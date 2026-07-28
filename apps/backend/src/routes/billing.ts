import { Router, NextFunction } from 'express';
import { z } from 'zod';
import type { WorkspaceRole } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import * as subscriptionService from '../services/subscription.service.js';
import * as paymentMethodService from '../services/paymentMethod.service.js';
import * as invoiceService from '../services/invoice.service.js';
import * as creditService from '../services/credit.service.js';
import { NotFoundException } from '@synora/shared';
import { prisma } from '@synora/database';

const router: Router = Router({ mergeParams: true });

const parseOptionalDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value as string);
  return isNaN(date.getTime()) ? undefined : date;
};

router.use(authMiddleware);

// Middleware to inject userRole for workspace-scoped billing routes
router.use(async (req: AuthRequest, res, next: NextFunction) => {
  try {
    // Extract workspaceId from path: /{id}/billing/...
    const pathSegments = req.path.split('/').filter(Boolean);
    const workspaceId = pathSegments[0];

    if (workspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: req.userId!, workspaceId } },
        select: { role: true },
      });
      if (!member) {
        throw new NotFoundException('You are not a member of this workspace');
      }
      req.userRole = member.role;
    }
    next();
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/subscription
router.get('/:id/billing/subscription', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:view');

    const subscription = await subscriptionService.getSubscriptionForWorkspace(
      req.userId!,
      workspaceId
    );

    res.json(subscription);
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/checkout
router.post('/:id/billing/checkout', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const schema = z.object({ planId: z.string(), successUrl: z.string(), cancelUrl: z.string() });
    const input = schema.parse(req.body);

    const session = await subscriptionService.createCheckoutSession(req.userId!, workspaceId, input);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workspaces/:id/billing/subscription
router.patch('/:id/billing/subscription', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const schema = z.object({ planId: z.string() });
    const input = schema.parse(req.body);

    const updated = await subscriptionService.changePlan(req.userId!, workspaceId, input);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/subscription/cancel
router.post('/:id/billing/subscription/cancel', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const schema = z.object({ atPeriodEnd: z.boolean() });
    const input = schema.parse(req.body);

    const updated = await subscriptionService.cancelSubscription(req.userId!, workspaceId, input);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/subscription/reactivate
router.post('/:id/billing/subscription/reactivate', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const updated = await subscriptionService.reactivateSubscription(req.userId!, workspaceId);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/portal
router.post('/:id/billing/portal', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const schema = z.object({ returnUrl: z.string() });
    const input = schema.parse(req.body);

    const session = await subscriptionService.createBillingPortalSession(
      req.userId!,
      workspaceId,
      input.returnUrl
    );
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/invoices
router.get('/:id/billing/invoices', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:view');

    const before = parseOptionalDate(req.query.before);
    const invoices = await invoiceService.listInvoices(req.userId!, workspaceId, { before });

    res.json(invoices);
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/invoices/:invoiceId
router.get('/:id/billing/invoices/:invoiceId', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    const invoiceId = req.params.invoiceId;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:view');

    const invoice = await invoiceService.getInvoice(req.userId!, workspaceId, invoiceId);
    res.json(invoice);
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/payment-methods
router.get('/:id/billing/payment-methods', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const methods = await paymentMethodService.listPaymentMethods(req.userId!, workspaceId);
    res.json(methods);
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/payment-methods/setup
router.post('/:id/billing/payment-methods/setup', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const schema = z.object({ successUrl: z.string(), cancelUrl: z.string() });
    const input = schema.parse(req.body);

    const session = await paymentMethodService.createSetupSession(req.userId!, workspaceId, input);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workspaces/:id/billing/payment-methods/:pmId
router.patch('/:id/billing/payment-methods/:pmId', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    const pmId = req.params.pmId;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    const schema = z.object({ isDefault: z.boolean() });
    const input = schema.parse(req.body);

    if (input.isDefault) {
      const updated = await paymentMethodService.setDefaultPaymentMethod(
        req.userId!,
        workspaceId,
        pmId
      );
      res.json(updated);
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workspaces/:id/billing/payment-methods/:pmId
router.delete('/:id/billing/payment-methods/:pmId', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    const pmId = req.params.pmId;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:manage');

    await paymentMethodService.removePaymentMethod(req.userId!, workspaceId, pmId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/credits
router.get('/:id/billing/credits', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:view');

    const balance = await creditService.getCreditBalance(req.userId!, workspaceId);
    res.json({ balance });
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/credits/ledger
router.get('/:id/billing/credits/ledger', async (req: AuthRequest, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole! as WorkspaceRole, 'billing:view');

    const before = parseOptionalDate(req.query.before);
    const ledger = await creditService.listCreditLedger(req.userId!, workspaceId, { before });

    res.json(ledger);
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/usage
router.get('/:id/billing/usage', async (req: AuthRequest, res, next) => {
  try {
    const pathSegments = req.path.split('/').filter(Boolean);
    const workspaceId = pathSegments[0];
    requirePermission(req.userRole! as WorkspaceRole, 'billing:view');

    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const summary = await creditService.getUsageSummary(req.userId!, workspaceId, { from, to });

    res.json(summary);
  } catch (error) {
    next(error);
  }
});

export default router;
