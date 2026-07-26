import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { requireMembership } from '../middleware/requireMembership.js';
import { requirePermission } from '../services/permissions.js';
import * as subscriptionService from '../services/subscription.service.js';
import * as paymentMethodService from '../services/paymentMethod.service.js';
import * as invoiceService from '../services/invoice.service.js';
import * as creditService from '../services/credit.service.js';
import { createApiResponse, createApiError, ValidationException } from '@synora/shared';

const router = Router({ mergeParams: true });

router.use(authMiddleware);
router.use(requireMembership);

// GET /api/workspaces/:id/billing/subscription
router.get('/:id/billing/subscription', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:view');

    const subscription = await subscriptionService.getSubscriptionForWorkspace(
      req.userId!,
      workspaceId
    );

    res.json(createApiResponse(subscription));
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/checkout
router.post('/:id/billing/checkout', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const schema = z.object({ planId: z.string(), successUrl: z.string(), cancelUrl: z.string() });
    const input = schema.parse(req.body);

    const session = await subscriptionService.createCheckoutSession(req.userId!, workspaceId, input);
    res.json(createApiResponse(session));
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workspaces/:id/billing/subscription
router.patch('/:id/billing/subscription', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const schema = z.object({ planId: z.string() });
    const input = schema.parse(req.body);

    const updated = await subscriptionService.changePlan(req.userId!, workspaceId, input);
    res.json(createApiResponse(updated));
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/subscription/cancel
router.post('/:id/billing/subscription/cancel', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const schema = z.object({ atPeriodEnd: z.boolean() });
    const input = schema.parse(req.body);

    const updated = await subscriptionService.cancelSubscription(req.userId!, workspaceId, input);
    res.json(createApiResponse(updated));
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/subscription/reactivate
router.post('/:id/billing/subscription/reactivate', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const updated = await subscriptionService.reactivateSubscription(req.userId!, workspaceId);
    res.json(createApiResponse(updated));
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/portal
router.post('/:id/billing/portal', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const schema = z.object({ returnUrl: z.string() });
    const input = schema.parse(req.body);

    const session = await subscriptionService.createBillingPortalSession(
      req.userId!,
      workspaceId,
      input.returnUrl
    );
    res.json(createApiResponse(session));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/invoices
router.get('/:id/billing/invoices', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:view');

    const before = req.query.before ? new Date(req.query.before as string) : undefined;
    const invoices = await invoiceService.listInvoices(req.userId!, workspaceId, { before });

    res.json(createApiResponse(invoices));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/invoices/:invoiceId
router.get('/:id/billing/invoices/:invoiceId', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const invoiceId = req.params.invoiceId;
    requirePermission(req.userRole, 'billing:view');

    const invoice = await invoiceService.getInvoice(req.userId!, workspaceId, invoiceId);
    res.json(createApiResponse(invoice));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/payment-methods
router.get('/:id/billing/payment-methods', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const methods = await paymentMethodService.listPaymentMethods(req.userId!, workspaceId);
    res.json(createApiResponse(methods));
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces/:id/billing/payment-methods/setup
router.post('/:id/billing/payment-methods/setup', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:manage');

    const schema = z.object({ successUrl: z.string(), cancelUrl: z.string() });
    const input = schema.parse(req.body);

    const session = await paymentMethodService.createSetupSession(req.userId!, workspaceId, input);
    res.json(createApiResponse(session));
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workspaces/:id/billing/payment-methods/:pmId
router.patch('/:id/billing/payment-methods/:pmId', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const pmId = req.params.pmId;
    requirePermission(req.userRole, 'billing:manage');

    const schema = z.object({ isDefault: z.boolean() });
    const input = schema.parse(req.body);

    if (input.isDefault) {
      const updated = await paymentMethodService.setDefaultPaymentMethod(
        req.userId!,
        workspaceId,
        pmId
      );
      res.json(createApiResponse(updated));
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workspaces/:id/billing/payment-methods/:pmId
router.delete('/:id/billing/payment-methods/:pmId', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const pmId = req.params.pmId;
    requirePermission(req.userRole, 'billing:manage');

    await paymentMethodService.removePaymentMethod(req.userId!, workspaceId, pmId);
    res.json(createApiResponse({ success: true }));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/credits
router.get('/:id/billing/credits', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:view');

    const balance = await creditService.getCreditBalance(req.userId!, workspaceId);
    res.json(createApiResponse({ balance }));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/credits/ledger
router.get('/:id/billing/credits/ledger', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:view');

    const before = req.query.before ? new Date(req.query.before as string) : undefined;
    const ledger = await creditService.listCreditLedger(req.userId!, workspaceId, { before });

    res.json(createApiResponse(ledger));
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id/billing/usage
router.get('/:id/billing/usage', async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    requirePermission(req.userRole, 'billing:view');

    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const summary = await creditService.getUsageSummary(req.userId!, workspaceId, { from, to });

    res.json(createApiResponse(summary));
  } catch (error) {
    next(error);
  }
});

export default router;
