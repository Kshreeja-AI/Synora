import { Router } from 'express';
import * as planService from '../services/plan.service.js';

const router: Router = Router();

// Public: GET /api/billing/plans (list available plans)
// Used by the pricing page and in-app plan selection UI.
// No authentication required — plans are public data.
router.get('/plans', async (req, res, next) => {
  try {
    const plans = await planService.listActivePlans();
    res.json(plans);
  } catch (error) {
    next(error);
  }
});

export default router;
