import { Router, Request, Response } from 'express';
import { requireAdminRole } from '../middleware/requireAdminRole.js';
import { engineeringEventBus } from './event-bus.js';
import { runHealthProbes } from './health-collector.js';

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

router.post('/health/check', async (_req: Request, res: Response) => {
  await runHealthProbes();
  const events = engineeringEventBus.recentByType('health.check', 20);
  res.json({ data: events });
});

router.get('/boot', (_req: Request, res: Response) => {
  const events = engineeringEventBus.recentByType('server.boot', 10);
  res.json({ data: events });
});

export { router as eosRouter };
