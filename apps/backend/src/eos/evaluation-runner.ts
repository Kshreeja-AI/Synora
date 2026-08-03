import { engineeringEventBus } from './event-bus.js';
import { applyGraders, type GradeResult } from './evaluation-graders.js';
import { getCases, getDataset, type CaseOrigin } from './evaluation-datasets.js';

/**
 * How a case is actually executed. Injected by the caller, so the runner
 * never knows which provider, model, or prompt is under test — that is
 * what keeps evaluation usable against anything.
 */
export type CaseExecutor = (input: string) => Promise<{
  output: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}>;

export interface CaseResult {
  caseId: string;
  passed: boolean;
  score: number;
  output: string;
  latencyMs: number;
  costCents: number;
  origin: CaseOrigin;
  tags: string[];
  graderResults: Array<GradeResult & { grader: string }>;
  error?: string;
}

export interface EvaluationRunResult {
  runId: string;
  datasetId: string;
  datasetVersion: number;
  label: string;
  startedAt: number;
  finishedAt: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  erroredCases: number;
  passRate: number;
  meanScore: number;
  totalCostCents: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  results: CaseResult[];
}

export interface RunOptions {
  /** Names what was under test, e.g. "claude-x / summarize v3". */
  label?: string;
  tag?: string;
  origin?: CaseOrigin;
  /** Cases run concurrently. Kept modest to avoid provider rate limits. */
  concurrency?: number;
}

let runCounter = 0;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Runs every selected case and scores it. An executor that throws marks
 * that single case as errored rather than aborting the run — one broken
 * case must not destroy the evidence from all the others.
 */
export async function runEvaluation(
  datasetId: string,
  executor: CaseExecutor,
  options: RunOptions = {},
): Promise<EvaluationRunResult | null> {
  const dataset = getDataset(datasetId);
  if (!dataset) return null;

  const cases = getCases(datasetId, { tag: options.tag, origin: options.origin });
  const startedAt = Date.now();
  const runId = `run_${startedAt}_${++runCounter}`;

  const results = await mapWithConcurrency(cases, options.concurrency ?? 4, async (evalCase): Promise<CaseResult> => {
    const began = Date.now();
    try {
      const execution = await executor(evalCase.input);
      const graded = applyGraders(execution.output, evalCase.expected, evalCase.graders);
      return {
        caseId: evalCase.id,
        passed: graded.passed,
        score: graded.score,
        output: execution.output,
        latencyMs: execution.latencyMs ?? Date.now() - began,
        costCents: execution.costCents ?? 0,
        origin: evalCase.origin,
        tags: evalCase.tags,
        graderResults: graded.results,
      };
    } catch (err) {
      return {
        caseId: evalCase.id,
        passed: false,
        score: 0,
        output: '',
        latencyMs: Date.now() - began,
        costCents: 0,
        origin: evalCase.origin,
        tags: evalCase.tags,
        graderResults: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const finishedAt = Date.now();
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const passedCases = results.filter((r) => r.passed).length;
  const erroredCases = results.filter((r) => r.error !== undefined).length;

  const run: EvaluationRunResult = {
    runId,
    datasetId,
    datasetVersion: dataset.version,
    label: options.label ?? 'unlabelled',
    startedAt,
    finishedAt,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    erroredCases,
    passRate: results.length > 0 ? passedCases / results.length : 0,
    meanScore: results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0,
    totalCostCents: results.reduce((sum, r) => sum + r.costCents, 0),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    results,
  };

  engineeringEventBus.emit({
    type: 'evaluation.run.completed',
    timestamp: finishedAt,
    source: 'evaluation-runner',
    payload: {
      runId: run.runId,
      datasetId: run.datasetId,
      datasetVersion: run.datasetVersion,
      label: run.label,
      totalCases: run.totalCases,
      passRate: run.passRate,
      meanScore: run.meanScore,
      erroredCases: run.erroredCases,
      durationMs: finishedAt - startedAt,
    },
  });

  return run;
}

export interface RunComparison {
  baselineRunId: string;
  candidateRunId: string;
  /** True only when the datasets match — comparing across datasets is meaningless. */
  comparable: boolean;
  passRateDelta: number;
  meanScoreDelta: number;
  costDeltaCents: number;
  p95LatencyDeltaMs: number;
  improved: string[];
  regressed: string[];
  unchanged: string[];
  verdict: 'improvement' | 'regression' | 'mixed' | 'no-change' | 'incomparable';
}

/**
 * Compares two runs case by case. This is the step that turns "the new
 * prompt feels better" into a defensible claim — or refutes it.
 */
export function compareRuns(baseline: EvaluationRunResult, candidate: EvaluationRunResult): RunComparison {
  const comparable = baseline.datasetId === candidate.datasetId;

  const baselineById = new Map(baseline.results.map((r) => [r.caseId, r]));
  const improved: string[] = [];
  const regressed: string[] = [];
  const unchanged: string[] = [];

  for (const cand of candidate.results) {
    const base = baselineById.get(cand.caseId);
    if (!base) continue;
    if (cand.score > base.score) improved.push(cand.caseId);
    else if (cand.score < base.score) regressed.push(cand.caseId);
    else unchanged.push(cand.caseId);
  }

  let verdict: RunComparison['verdict'];
  if (!comparable) verdict = 'incomparable';
  else if (improved.length > 0 && regressed.length > 0) verdict = 'mixed';
  else if (improved.length > 0) verdict = 'improvement';
  else if (regressed.length > 0) verdict = 'regression';
  else verdict = 'no-change';

  return {
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    comparable,
    passRateDelta: candidate.passRate - baseline.passRate,
    meanScoreDelta: candidate.meanScore - baseline.meanScore,
    costDeltaCents: candidate.totalCostCents - baseline.totalCostCents,
    p95LatencyDeltaMs: candidate.p95LatencyMs - baseline.p95LatencyMs,
    improved,
    regressed,
    unchanged,
    verdict,
  };
}
