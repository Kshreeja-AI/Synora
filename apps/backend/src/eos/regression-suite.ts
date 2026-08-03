import { runEvaluation, compareRuns, type CaseExecutor, type EvaluationRunResult } from './evaluation-runner.js';
import { recordGateMeasurement } from './launch-gates.js';
import { getBaselineStore } from './baseline-store.js';

/**
 * Measures the regression gate: has anything that used to work stopped
 * working?
 *
 * THE TRAP THIS AVOIDS. The obvious implementation runs a dataset twice and
 * compares. With a deterministic executor that always yields zero
 * regressions — you have compared a system to itself and proved nothing,
 * while the gate turns green. That is exactly the unearned pass this whole
 * phase exists to prevent.
 *
 * SO IT COMPARES AGAINST A STORED BASELINE FROM AN EARLIER RUN. A
 * regression is a case that scored well when the baseline was captured and
 * scores worse now. That is a statement about change over time, which is
 * what the gate actually asks.
 *
 * WITH NO BASELINE, THE GATE STAYS UNMEASURED. A first run has nothing to
 * regress against, and recording "0 regressions" for it would be true,
 * vacuous, and read as a pass. The first run captures the baseline and
 * records nothing.
 *
 * WHAT A DETERMINISTIC EXECUTOR CAN AND CANNOT CATCH, stated plainly:
 * because the executor is fixed, any change in results comes from Synora's
 * own logic — graders, the runner, redaction, scoring. That is a real and
 * useful regression signal covering the platform's own behaviour. It says
 * nothing about provider quality drifting, which needs real provider calls
 * and is a different gate.
 */

export interface RegressionRun {
  runId: string;
  datasetId: string;
  capturedAt: number;
  /** Score per case id, which is what a later run is compared against. */
  scores: Record<string, number>;
  meanScore: number;
  totalCases: number;
}

export interface RegressionResult {
  datasetId: string;
  /** Case ids that scored lower than the baseline. */
  regressed: string[];
  improved: string[];
  unchanged: string[];
  /** Cases present now but absent from the baseline — not regressions. */
  newCases: string[];
  /** Cases in the baseline that no longer exist. Reported, not ignored. */
  missingCases: string[];
  baselineCapturedAt: number;
  meanScoreDelta: number;
}

/**
 * Baselines live behind a store seam so they outlive the process. Held in
 * memory they vanish on restart, and a regression suite whose reference
 * point disappears on every restart can never compare across the span in
 * which regressions happen.
 */
export function getBaseline(datasetId: string): Promise<RegressionRun | null> {
  return getBaselineStore().load(datasetId);
}

export function clearBaselines(): Promise<void> {
  return getBaselineStore().clear();
}

function toBaseline(run: EvaluationRunResult): RegressionRun {
  const scores: Record<string, number> = {};
  for (const result of run.results) scores[result.caseId] = result.score;

  return {
    runId: run.runId,
    datasetId: run.datasetId,
    capturedAt: run.finishedAt,
    scores,
    meanScore: run.meanScore,
    totalCases: run.totalCases,
  };
}

/**
 * Runs the dataset and, if a baseline exists, compares against it. Returns
 * null on the first run for a dataset — there is nothing to compare, and
 * saying so is more useful than reporting zero regressions.
 */
export async function runRegressionSuite(
  datasetId: string,
  executor: CaseExecutor,
): Promise<{ run: EvaluationRunResult; result: RegressionResult | null } | null> {
  const run = await runEvaluation(datasetId, executor, { label: `regression suite: ${datasetId}` });
  if (!run) return null;

  const baseline = await getBaselineStore().load(datasetId);
  if (!baseline) {
    await getBaselineStore().save(toBaseline(run));
    return { run, result: null };
  }

  const regressed: string[] = [];
  const improved: string[] = [];
  const unchanged: string[] = [];
  const newCases: string[] = [];

  for (const caseResult of run.results) {
    const before = baseline.scores[caseResult.caseId];
    if (before === undefined) {
      // A case that did not exist at baseline cannot have regressed, and
      // counting it as one would penalise adding coverage.
      newCases.push(caseResult.caseId);
    } else if (caseResult.score < before) {
      regressed.push(caseResult.caseId);
    } else if (caseResult.score > before) {
      improved.push(caseResult.caseId);
    } else {
      unchanged.push(caseResult.caseId);
    }
  }

  const currentIds = new Set(run.results.map((r) => r.caseId));
  const missingCases = Object.keys(baseline.scores).filter((id) => !currentIds.has(id));

  return {
    run,
    result: {
      datasetId,
      regressed,
      improved,
      unchanged,
      newCases,
      missingCases,
      baselineCapturedAt: baseline.capturedAt,
      meanScoreDelta: run.meanScore - baseline.meanScore,
    },
  };
}

/** Replaces the baseline with the given run. A deliberate act, never automatic. */
export function acceptAsBaseline(run: EvaluationRunResult): Promise<void> {
  return getBaselineStore().save(toBaseline(run));
}

/**
 * Runs the suite and records the regression count against the launch gate.
 * Records nothing when there is no baseline yet.
 */
export async function measureRegressionGate(
  datasetId: string,
  executor: CaseExecutor,
): Promise<RegressionResult | null> {
  const outcome = await runRegressionSuite(datasetId, executor);
  if (!outcome || !outcome.result) return null;

  recordGateMeasurement({
    gateId: 'regression-failures',
    value: outcome.result.regressed.length,
    source: `regression suite over dataset ${datasetId}, compared against the baseline captured at ${new Date(
      outcome.result.baselineCapturedAt,
    ).toISOString()}`,
    measuredAt: Date.now(),
    sampleSize: outcome.run.totalCases,
  });

  return outcome.result;
}

export { compareRuns };
