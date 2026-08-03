import { Router, Request, Response } from 'express';
import { createApiResponse, createApiError } from '@synora/shared';
import { requireAdminRole } from '../middleware/requireAdminRole.js';
import { engineeringEventBus } from './event-bus.js';
import { runHealthProbes } from './health-collector.js';
import { sampleQueueDepths } from './queue-depth-collector.js';
import { getErrorRateSnapshot } from './error-rate-monitor.js';
import { sampleMemory } from './memory-collector.js';
import { getLatencySnapshot } from './latency-tracker.js';
import { getPromptReport } from './prompt-intelligence.js';
import { getCostReport } from './cost-monitor.js';
import { captureSnapshot, queryHistory, getHistoryStore } from './history-recorder.js';
import { listDatasets, summarizeDataset, getCases } from './evaluation-datasets.js';
import { listGraders } from './evaluation-graders.js';
import { getCaptureStats } from './case-capture.js';
import { getProviderMatrix } from './provider-observatory.js';
import { getAiPathCoverage } from './instrumentation.js';
import { listProposals, getProposal, decideProposal, type ProposalStatus } from './proposal-engine.js';

const router: Router = Router();

router.use(requireAdminRole);

router.get('/events/recent', (_req: Request, res: Response) => {
  const limit = Math.min(Number(_req.query.limit) || 100, 500);
  const type = _req.query.type as string | undefined;
  const events = type
    ? engineeringEventBus.recentByType(type, limit)
    : engineeringEventBus.recentEvents(limit);
  res.json(createApiResponse(events));
});

router.get('/events/stats', (_req: Request, res: Response) => {
  res.json(createApiResponse(engineeringEventBus.stats()));
});

router.post('/health/check', async (_req: Request, res: Response) => {
  await runHealthProbes();
  const events = engineeringEventBus.recentByType('health.check', 20);
  res.json(createApiResponse(events));
});

router.get('/boot', (_req: Request, res: Response) => {
  const events = engineeringEventBus.recentByType('server.boot', 10);
  res.json(createApiResponse(events));
});

router.post('/queue-depth', async (_req: Request, res: Response) => {
  await sampleQueueDepths();
  const events = engineeringEventBus.recentByType('queue.depth', 50);
  res.json(createApiResponse(events));
});

router.get('/error-rate', (_req: Request, res: Response) => {
  const snapshot = getErrorRateSnapshot();
  const alerts = engineeringEventBus.recentByType('alert.error_rate', 20);
  res.json(createApiResponse({ current: snapshot, recentAlerts: alerts }));
});

router.post('/memory', (_req: Request, res: Response) => {
  sampleMemory();
  const events = engineeringEventBus.recentByType('process.memory', 20);
  res.json(createApiResponse(events));
});

router.get('/provider-matrix', (_req: Request, res: Response) => {
  res.json(createApiResponse(getProviderMatrix()));
});

router.get('/latency', (_req: Request, res: Response) => {
  const snapshot = getLatencySnapshot();
  const summaries = engineeringEventBus.recentByType('api.latency.summary', 20);
  res.json(createApiResponse({ current: snapshot, recentSummaries: summaries }));
});

router.get('/prompt-report', (_req: Request, res: Response) => {
  const alerts = engineeringEventBus.recentByType('alert.prompt_regression', 20);
  res.json(createApiResponse({ report: getPromptReport(), recentAlerts: alerts }));
});

router.get('/cost-report', (_req: Request, res: Response) => {
  const alerts = engineeringEventBus.recentByType('alert.cost_anomaly', 20);
  res.json(createApiResponse({ report: getCostReport(), recentAlerts: alerts }));
});

router.get('/history', async (_req: Request, res: Response) => {
  const limit = Math.min(Number(_req.query.limit) || 100, 1000);
  const since = _req.query.since ? Number(_req.query.since) : undefined;
  const until = _req.query.until ? Number(_req.query.until) : undefined;
  const snapshots = await queryHistory({ since, until, limit });
  res.json(createApiResponse({ store: getHistoryStore().kind, count: snapshots.length, snapshots }));
});

router.post('/history/capture', async (_req: Request, res: Response) => {
  const snapshot = await captureSnapshot();
  if (!snapshot) {
    res.status(503).json(createApiError('SNAPSHOT_FAILED', 'Snapshot capture failed'));
    return;
  }
  res.json(createApiResponse(snapshot));
});

router.get('/evaluation/datasets', (_req: Request, res: Response) => {
  res.json(createApiResponse(listDatasets()));
});

router.get('/evaluation/datasets/:datasetId', (req: Request, res: Response) => {
  const summary = summarizeDataset(req.params.datasetId);
  if (!summary) {
    res.status(404).json(createApiError('NOT_FOUND', 'Dataset not found'));
    return;
  }
  res.json(createApiResponse({ ...summary, cases: getCases(req.params.datasetId) }));
});

router.get('/evaluation/graders', (_req: Request, res: Response) => {
  res.json(createApiResponse(listGraders()));
});

router.get('/evaluation/runs', (_req: Request, res: Response) => {
  res.json(createApiResponse(engineeringEventBus.recentByType('evaluation.run.completed', 50)));
});

router.get('/evaluation/capture', (_req: Request, res: Response) => {
  const events = engineeringEventBus.recentByType('evaluation.case.captured', 50);
  res.json(createApiResponse({ stats: getCaptureStats(), recentCaptures: events }));
});

router.get('/coverage', (_req: Request, res: Response) => {
  res.json(createApiResponse(getAiPathCoverage()));
});

router.get('/proposals', (req: Request, res: Response) => {
  const status = req.query.status as ProposalStatus | undefined;
  res.json(createApiResponse(listProposals(status)));
});

router.get('/proposals/:id', (req: Request, res: Response) => {
  const proposal = getProposal(req.params.id);
  if (!proposal) {
    res.status(404).json(createApiError('NOT_FOUND', 'Proposal not found'));
    return;
  }
  res.json(createApiResponse(proposal));
});

/**
 * Records a founder decision. Approving does not execute the suggested
 * action — there is no execution path in the proposal engine at all.
 */
router.post('/proposals/:id/decide', (req: Request, res: Response) => {
  const { decision, note } = req.body ?? {};
  if (decision !== 'approved' && decision !== 'rejected') {
    res
      .status(400)
      .json(createApiError('VALIDATION_ERROR', "decision must be 'approved' or 'rejected'"));
    return;
  }
  const proposal = decideProposal(req.params.id, decision, typeof note === 'string' ? note : undefined);
  if (!proposal) {
    res.status(404).json(createApiError('NOT_FOUND', 'Proposal not found'));
    return;
  }
  res.json(createApiResponse(proposal));
});

export { router as eosRouter };
