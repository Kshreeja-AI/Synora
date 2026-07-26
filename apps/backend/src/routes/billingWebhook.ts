import { Router } from 'express';
import { handleBillingWebhook } from '../services/webhook.service.js';
import { createApiResponse } from '@synora/shared';
import { logger } from '../middleware/logger.js';

const router = Router();

// POST /api/billing/webhook (raw body)
router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_SIGNATURE', message: 'Missing stripe-signature header' },
      });
    }

    await handleBillingWebhook(req.body as Buffer, signature);
    res.json(createApiResponse({ received: true }));
  } catch (error) {
    logger.error('Webhook processing failed', { error });
    next(error);
  }
});

export default router;
