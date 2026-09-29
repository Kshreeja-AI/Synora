import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  addCase,
  createDataset,
  getCases,
  getDataset,
  listDatasets,
  removeCase,
  resetDatasets,
  summarizeDataset,
} from '../evaluation-datasets';
import { compareRuns, runEvaluation, type EvaluationRunResult } from '../evaluation-runner';

describe('evaluation-datasets', () => {
  beforeEach(() => {
    resetDatasets();
  });

  it('creates a dataset and adds cases', () => {
    createDataset({ id: 'ds1', name: 'Summarisation' });
    addCase('ds1', {
      id: 'c1',
      input: 'long text',
      expected: 'short summary',
      graders: [{ grader: 'nonEmpty' }],
      origin: 'real',
      tags: ['summary'],
    });

    const ds = getDataset('ds1')!;
    expect(ds.cases).toHaveLength(1);
    expect(ds.version).toBe(2); // incremented on mutation
  });

  it('records case origin so synthetic data is never mistaken for real', () => {
    createDataset({ id: 'ds1', name: 'Mixed' });
    addCase('ds1', { id: 'r', input: 'a', graders: [{ grader: 'nonEmpty' }], origin: 'real' });
    addCase('ds1', { id: 's', input: 'b', graders: [{ grader: 'nonEmpty' }], origin: 'synthetic' });

    const summary = summarizeDataset('ds1')!;
    expect(summary.realCases).toBe(1);
    expect(summary.syntheticCases).toBe(1);
    expect(getCases('ds1', { origin: 'synthetic' }).map((c) => c.id)).toEqual(['s']);
  });

  it('replaces a case with the same id rather than duplicating it', () => {
    createDataset({ id: 'ds1', name: 'D' });
    addCase('ds1', { id: 'c1', input: 'v1', graders: [{ grader: 'nonEmpty' }], origin: 'real' });
    addCase('ds1', { id: 'c1', input: 'v2', graders: [{ grader: 'nonEmpty' }], origin: 'real' });

    const ds = getDataset('ds1')!;
    expect(ds.cases).toHaveLength(1);
    expect(ds.cases[0].input).toBe('v2');
  });

  it('filters cases by tag', () => {
    createDataset({ id: 'ds1', name: 'D' });
    addCase('ds1', { id: 'a', input: 'x', graders: [], origin: 'real', tags: ['fast'] });
    addCase('ds1', { id: 'b', input: 'y', graders: [], origin: 'real', tags: ['slow'] });

    expect(getCases('ds1', { tag: 'fast' }).map((c) => c.id)).toEqual(['a']);
  });

  it('removes cases and bumps the version', () => {
    createDataset({ id: 'ds1', name: 'D' });
    addCase('ds1', { id: 'c1', input: 'x', graders: [], origin: 'real' });
    const before = getDataset('ds1')!.version;

    expect(removeCase('ds1', 'c1')).toBe(true);
    expect(removeCase('ds1', 'missing')).toBe(false);
    expect(getDataset('ds1')!.cases).toHaveLength(0);
    expect(getDataset('ds1')!.version).toBeGreaterThan(before);
  });

  it('addCase on an unknown dataset returns null instead of throwing', () => {
    expect(addCase('nope', { id: 'c', input: 'x', graders: [], origin: 'real' })).toBeNull();
  });

  it('lists dataset summaries', () => {
    createDataset({ id: 'ds1', name: 'One' });
    createDataset({ id: 'ds2', name: 'Two' });
    expect(listDatasets().map((d) => d.id).sort()).toEqual(['ds1', 'ds2']);
  });
});

describe('evaluation-runner', () => {
  beforeEach(() => {
    resetDatasets();
    createDataset({ id: 'ds', name: 'Runner dataset' });
  });

  function addPassingCase(id: string, expected: string) {
    addCase('ds', {
      id,
      input: `input-${id}`,
      expected,
      graders: [{ grader: 'contains' }],
      origin: 'real',
    });
  }

  it('runs every case and aggregates the result', async () => {
    addPassingCase('c1', 'alpha');
    addPassingCase('c2', 'beta');

    const run = (await runEvaluation('ds', async (input) => ({
      output: input === 'input-c1' ? 'contains alpha here' : 'contains beta here',
      latencyMs: 10,
      costCents: 2,
    })))!;

    expect(run.totalCases).toBe(2);
    expect(run.passedCases).toBe(2);
    expect(run.passRate).toBe(1);
    expect(run.meanScore).toBe(1);
    expect(run.totalCostCents).toBe(4);
    expect(run.datasetVersion).toBe(getDataset('ds')!.version);
  });

  it('marks failing cases without failing the run', async () => {
    addPassingCase('c1', 'alpha');
    addPassingCase('c2', 'beta');

    const run = (await runEvaluation('ds', async () => ({ output: 'only alpha' })))!;

    expect(run.passedCases).toBe(1);
    expect(run.failedCases).toBe(1);
    expect(run.passRate).toBe(0.5);
  });

  it('an executor that throws errors only that case', async () => {
    addPassingCase('good', 'alpha');
    addPassingCase('bad', 'beta');

    const run = (await runEvaluation('ds', async (input) => {
      if (input === 'input-bad') throw new Error('provider timeout');
      return { output: 'contains alpha' };
    }))!;

    // One broken case must not destroy the evidence from the others.
    expect(run.totalCases).toBe(2);
    expect(run.erroredCases).toBe(1);
    expect(run.passedCases).toBe(1);
    const errored = run.results.find((r) => r.caseId === 'bad')!;
    expect(errored.error).toContain('provider timeout');
  });

  it('emits an evaluation.run.completed event', async () => {
    addPassingCase('c1', 'alpha');
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('evaluation.run.completed', (e) => events.push(e));

    await runEvaluation('ds', async () => ({ output: 'alpha' }), { label: 'claude-x / v1' });

    expect(events).toHaveLength(1);
    const event = events[0] as { payload: { label: string; passRate: number } };
    expect(event.payload.label).toBe('claude-x / v1');
    expect(event.payload.passRate).toBe(1);
    unsub();
  });

  it('returns null for an unknown dataset', async () => {
    expect(await runEvaluation('missing', async () => ({ output: 'x' }))).toBeNull();
  });

  it('runs only the cases matching a tag filter', async () => {
    addCase('ds', { id: 'a', input: 'x', graders: [{ grader: 'nonEmpty' }], origin: 'real', tags: ['quick'] });
    addCase('ds', { id: 'b', input: 'y', graders: [{ grader: 'nonEmpty' }], origin: 'real', tags: ['slow'] });

    const run = (await runEvaluation('ds', async () => ({ output: 'ok' }), { tag: 'quick' }))!;
    expect(run.totalCases).toBe(1);
    expect(run.results[0].caseId).toBe('a');
  });

  it('handles an empty dataset without dividing by zero', async () => {
    const run = (await runEvaluation('ds', async () => ({ output: 'x' })))!;
    expect(run.totalCases).toBe(0);
    expect(run.passRate).toBe(0);
    expect(run.meanScore).toBe(0);
  });
});

describe('compareRuns', () => {
  beforeEach(() => {
    resetDatasets();
    createDataset({ id: 'ds', name: 'Compare dataset' });
    addCase('ds', {
      id: 'c1',
      input: 'in',
      expected: 'target',
      graders: [{ grader: 'contains' }],
      origin: 'real',
    });
  });

  async function run(output: string, costCents: number): Promise<EvaluationRunResult> {
    return (await runEvaluation('ds', async () => ({ output, costCents, latencyMs: 10 })))!;
  }

  it('detects an improvement', async () => {
    const baseline = await run('missing', 1);
    const candidate = await run('has target inside', 1);

    const cmp = compareRuns(baseline, candidate);
    expect(cmp.verdict).toBe('improvement');
    expect(cmp.improved).toEqual(['c1']);
    expect(cmp.passRateDelta).toBe(1);
  });

  it('detects a regression', async () => {
    const baseline = await run('has target inside', 1);
    const candidate = await run('missing', 1);

    const cmp = compareRuns(baseline, candidate);
    expect(cmp.verdict).toBe('regression');
    expect(cmp.regressed).toEqual(['c1']);
    expect(cmp.meanScoreDelta).toBe(-1);
  });

  it('reports no-change and a cost delta', async () => {
    const baseline = await run('has target', 10);
    const candidate = await run('has target', 4);

    const cmp = compareRuns(baseline, candidate);
    expect(cmp.verdict).toBe('no-change');
    expect(cmp.unchanged).toEqual(['c1']);
    // Same quality for less money is exactly the decision this enables.
    expect(cmp.costDeltaCents).toBe(-6);
  });

  it('refuses to compare runs from different datasets', async () => {
    const baseline = await run('has target', 1);

    createDataset({ id: 'other', name: 'Other' });
    addCase('other', { id: 'x', input: 'i', graders: [{ grader: 'nonEmpty' }], origin: 'real' });
    const candidate = (await runEvaluation('other', async () => ({ output: 'ok' })))!;

    const cmp = compareRuns(baseline, candidate);
    expect(cmp.comparable).toBe(false);
    expect(cmp.verdict).toBe('incomparable');
  });
});
