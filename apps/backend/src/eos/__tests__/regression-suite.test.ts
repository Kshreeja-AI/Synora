/**
 * Regression suite tests.
 *
 * The trap this module exists to avoid: running a deterministic dataset
 * twice and comparing yields zero regressions every time, turning the gate
 * green while proving nothing. These tests hold the line that a first run
 * measures nothing, and that a real regression is detected as one.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  acceptAsBaseline,
  clearBaselines,
  getBaseline,
  measureRegressionGate,
  runRegressionSuite,
} from '../regression-suite';
import { createDataset, addCase, resetDatasets } from '../evaluation-datasets';
import { clearGateMeasurements, getLaunchReadiness } from '../launch-gates';
import type { CaseExecutor } from '../evaluation-runner';

/** Returns whatever the map says for an input — deterministic by design. */
function executorFor(answers: Record<string, string>): CaseExecutor {
  return async (input: string) => ({ output: answers[input] ?? '' });
}

function seedDataset(id = 'regression') {
  createDataset({ id, name: 'Regression suite' });
  addCase(id, {
    id: 'case_a',
    input: 'a',
    expected: 'alpha',
    graders: [{ grader: 'exact' }],
    origin: 'synthetic',
  });
  addCase(id, {
    id: 'case_b',
    input: 'b',
    expected: 'beta',
    graders: [{ grader: 'exact' }],
    origin: 'synthetic',
  });
}

const goodAnswers = { a: 'alpha', b: 'beta' };

describe('regression-suite', () => {
  beforeEach(async () => {
    await clearBaselines();
    resetDatasets();
    clearGateMeasurements();
  });

  it('measures nothing on the first run, and says so', async () => {
    seedDataset();

    const outcome = await runRegressionSuite('regression', executorFor(goodAnswers));

    // A first run has nothing to regress against. Reporting zero
    // regressions would be true, vacuous, and read as a pass.
    expect(outcome!.result).toBeNull();
    expect(await getBaseline('regression')).not.toBeNull();
  });

  it('leaves the gate unmeasured after only a baseline run', async () => {
    seedDataset();

    await measureRegressionGate('regression', executorFor(goodAnswers));

    expect(getLaunchReadiness().gates.find((g) => g.id === 'regression-failures')!.status).toBe(
      'unmeasured',
    );
  });

  it('detects a case that used to pass and now fails', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor(goodAnswers));

    // Something in the platform changed and case_b now answers wrongly.
    const outcome = await runRegressionSuite('regression', executorFor({ a: 'alpha', b: 'wrong' }));

    expect(outcome!.result!.regressed).toEqual(['case_b']);
    expect(outcome!.result!.unchanged).toEqual(['case_a']);
    expect(outcome!.result!.meanScoreDelta).toBeLessThan(0);
  });

  it('reports an unchanged run as zero regressions, against a real baseline', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor(goodAnswers));

    const outcome = await runRegressionSuite('regression', executorFor(goodAnswers));

    // Zero here is meaningful because it is measured against a baseline
    // captured earlier, not against a fresh copy of the same run.
    expect(outcome!.result!.regressed).toEqual([]);
    expect(outcome!.result!.unchanged).toHaveLength(2);
  });

  it('records the regression count against the launch gate', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor(goodAnswers));

    await measureRegressionGate('regression', executorFor({ a: 'alpha', b: 'wrong' }));

    const gate = getLaunchReadiness().gates.find((g) => g.id === 'regression-failures')!;
    // The gate demands zero, so one regression fails it.
    expect(gate.status).toBe('failed');
    expect(gate.value).toBe(1);
    expect(gate.sampleSize).toBe(2);
    expect(gate.source).toMatch(/compared against the baseline captured at/);
  });

  it('passes the gate when a real comparison finds nothing regressed', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor(goodAnswers));

    await measureRegressionGate('regression', executorFor(goodAnswers));

    expect(getLaunchReadiness().gates.find((g) => g.id === 'regression-failures')!.status).toBe(
      'passed',
    );
  });

  it('counts an improvement as an improvement, never as a regression', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor({ a: 'alpha', b: 'wrong' }));

    const outcome = await runRegressionSuite('regression', executorFor(goodAnswers));

    expect(outcome!.result!.improved).toEqual(['case_b']);
    expect(outcome!.result!.regressed).toEqual([]);
  });

  it('does not penalise adding new coverage', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor(goodAnswers));

    addCase('regression', {
      id: 'case_c',
      input: 'c',
      expected: 'gamma',
      graders: [{ grader: 'exact' }],
      origin: 'synthetic',
    });
    // The new case fails outright, and it still is not a regression —
    // nothing that used to work has stopped working.
    const outcome = await runRegressionSuite('regression', executorFor(goodAnswers));

    expect(outcome!.result!.newCases).toEqual(['case_c']);
    expect(outcome!.result!.regressed).toEqual([]);
  });

  it('reports a case that vanished rather than ignoring it', async () => {
    seedDataset();
    await runRegressionSuite('regression', executorFor(goodAnswers));

    resetDatasets();
    createDataset({ id: 'regression', name: 'Regression suite' });
    addCase('regression', {
      id: 'case_a',
      input: 'a',
      expected: 'alpha',
      graders: [{ grader: 'exact' }],
      origin: 'synthetic',
    });

    const outcome = await runRegressionSuite('regression', executorFor(goodAnswers));

    // A disappearing case is not a regression, and silently dropping it
    // would let coverage shrink without anyone noticing.
    expect(outcome!.result!.missingCases).toEqual(['case_b']);
  });

  it('accepts a new baseline only when told to', async () => {
    seedDataset();
    const first = await runRegressionSuite('regression', executorFor(goodAnswers));
    const before = (await getBaseline('regression'))!.runId;

    const second = await runRegressionSuite('regression', executorFor({ a: 'alpha', b: 'wrong' }));
    // A run does not silently become the new baseline, or a regression
    // would erase the evidence of itself.
    expect((await getBaseline('regression'))!.runId).toBe(before);

    await acceptAsBaseline(second!.run);
    expect((await getBaseline('regression'))!.runId).not.toBe(before);
    expect(first!.run.runId).toBe(before);
  });

  it('returns null for a dataset that does not exist', async () => {
    expect(await runRegressionSuite('nope', executorFor(goodAnswers))).toBeNull();
  });
});
