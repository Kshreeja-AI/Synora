import { Router, Request, Response } from 'express';
import { requireAdminRole } from '../middleware/requireAdminRole.js';
import { engineeringEventBus } from './event-bus.js';
import { runHealthProbes } from './health-collector.js';
import { sampleQueueDepths } from './queue-depth-collector.js';
import { getErrorRateSnapshot } from './error-rate-monitor.js';
import { sampleMemory } from './memory-collector.js';
import { getLatencySnapshot } from './latency-tracker.js';
import { getPromptReport } from './prompt-intelligence.js';
import { captureSnapshot, queryHistory, getHistoryStore } from './history-recorder.js';
import { listDatasets, summarizeDataset, getCases } from './evaluation-datasets.js';
import { listGraders } from './evaluation-graders.js';
import { getCaptureStats } from './case-capture.js';
import { getProviderMatrix } from './provider-observatory.js';

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

router.post('/queue-depth', async (_req: Request, res: Response) => {
  await sampleQueueDepths();
  const events = engineeringEventBus.recentByType('queue.depth', 50);
  res.json({ data: events });
});

router.get('/error-rate', (_req: Request, res: Response) => {
  const snapshot = getErrorRateSnapshot();
  const alerts = engineeringEventBus.recentByType('alert.error_rate', 20);
  res.json({ data: { current: snapshot, recentAlerts: alerts } });
});

router.post('/memory', (_req: Request, res: Response) => {
  sampleMemory();
  const events = engineeringEventBus.recentByType('process.memory', 20);
  res.json({ data: events });
});

router.get('/provider-matrix', (_req: Request, res: Response) => {
  res.json({ data: getProviderMatrix() });
});

router.get('/latency', (_req: Request, res: Response) => {
  const snapshot = getLatencySnapshot();
  const summaries = engineeringEventBus.recentByType('api.latency.summary', 20);
  res.json({ data: { current: snapshot, recentSummaries: summaries } });
});

router.get('/prompt-report', (_req: Request, res: Response) => {
  const alerts = engineeringEventBus.recentByType('alert.prompt_regression', 20);
  res.json({ data: { report: getPromptReport(), recentAlerts: alerts } });
});

router.get('/history', async (_req: Request, res: Response) => {
  const limit = Math.min(Number(_req.query.limit) || 100, 1000);
  const since = _req.query.since ? Number(_req.query.since) : undefined;
  const until = _req.query.until ? Number(_req.query.until) : undefined;
  const snapshots = await queryHistory({ since, until, limit });
  res.json({ data: { store: getHistoryStore().kind, count: snapshots.length, snapshots } });
});

router.post('/history/capture', async (_req: Request, res: Response) => {
  const snapshot = await captureSnapshot();
  if (!snapshot) {
    res.status(503).json({ error: 'Snapshot capture failed' });
    return;
  }
  res.json({ data: snapshot });
});

router.get('/evaluation/datasets', (_req: Request, res: Response) => {
  res.json({ data: listDatasets() });
});

router.get('/evaluation/datasets/:datasetId', (req: Request, res: Response) => {
  const summary = summarizeDataset(req.params.datasetId);
  if (!summary) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  res.json({ data: { ...summary, cases: getCases(req.params.datasetId) } });
});

router.get('/evaluation/graders', (_req: Request, res: Response) => {
  res.json({ data: listGraders() });
});

router.get('/evaluation/runs', (_req: Request, res: Response) => {
  res.json({ data: engineeringEventBus.recentByType('evaluation.run.completed', 50) });
});

router.get('/evaluation/capture', (_req: Request, res: Response) => {
  const events = engineeringEventBus.recentByType('evaluation.case.captured', 50);
  res.json({ data: { stats: getCaptureStats(), recentCaptures: events } });
});

export { router as eosRouter };
