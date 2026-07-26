import { Router } from 'express';
import * as planService from '../services/plan.service.js';
import { createApiResponse } from '@synora/shared';

const router = Router();

// GET /api/billing/plans
router.get('/plans', async (req, res, next) => {
  try {
    const plans = await planService.listActivePlans();
    res.json(createApiResponse(plans));
  } catch (error) {
    next(error);
  }
});

export default router;
