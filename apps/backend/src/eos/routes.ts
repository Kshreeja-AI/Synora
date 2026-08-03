import { Router, Request, Response } from 'express';
import { requireAdminRole } from '../middleware/requireAdminRole.js';
import { engineeringEventBus } from './event-bus.js';

const router: Router = Router();

router.use(requireAdminRole);

router.get('/events/recent', (_req: Request, res: Response) => {
  const limit = Math.min(Number(_req.query.limit) || 100, 500);
  const type = _req.query.type as string | undefined;
  const events = type
    ? engineeringEventBus.recentByType(type, limit)
    : engineeringEventBus.recentEvents(limit);
  res.json({ data: events });
});

router.get('/events/stats', (_req: Request, res: Response) => {
  res.json({ data: engineeringEventBus.stats() });
});

export { router as eosRouter };
