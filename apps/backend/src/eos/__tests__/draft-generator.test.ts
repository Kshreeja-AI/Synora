import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  configureDraftGenerator,
  generateDraft,
  resetDraftGenerator,
  type Drafter,
} from '../draft-generator';
import { createDataset, addCase, resetDatasets } from '../evaluation-datasets';
import type { CaseExecutor } from '../evaluation-runner';

function seedFailures(datasetId = 'ds', promptId = 'summarize') {
  createDataset({ id: datasetId, name: 'Captured failures' });
  addCase(datasetId, {
    id: 'case_1',
    input: 'summarise this',
    actualOutput: 'a rambling non-summary',
    graders: [{ grader: 'contains', config: { value: 'summary' } }],
    expected: 'summary',
    origin: 'real',
    tags: [`prompt:${promptId}`],
  });
  addCase(datasetId, {
    id: 'case_2',
    input: 'summarise that',
    actualOutput: 'another miss',
    graders: [{ grader: 'contains', config: { value: 'summary' } }],
    expected: 'summary',
    origin: 'real',
    tags: [`prompt:${promptId}`],
  });
}

const drafter: Drafter = async () => 'You are a summariser. Answer with a one-line summary.';

/** Baseline fails every case; the draft passes them. */
const failingExecutor: CaseExecutor = async () => ({ output: 'rambling' });
const passingExecutorFactory = () => async () => ({ output: 'a short summary' });

describe('draft-generator', () => {
  beforeEach(() => {
    resetDraftGenerator();
    resetDatasets();
  });

  it('produces nothing, and says why, when no drafter is configured', async () => {
    seedFailures();

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.draft).toBeNull();
    expect(result.unavailable[0]).toMatch(/No drafter is configured/i);
    // Critically, this must not read as "the prompt looks fine".
    expect(result.summary).toMatch(/missing capability, not a judgement/i);
  });

  it('does not draft when there are no captured failures to draft against', async () => {
    createDataset({ id: 'ds', name: 'empty' });
    configureDraftGenerator({ drafter });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.draft).toBeNull();
    expect(result.unavailable[0]).toMatch(/No captured failing cases/i);
    expect(result.summary).toMatch(/guesswork/i);
  });

  it('passes the real failures to the drafter', async () => {
    seedFailures();
    const spy = vi.fn(drafter);
    configureDraftGenerator({ drafter: spy });

    await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    const request = spy.mock.calls[0][0];
    expect(request.promptId).toBe('summarize');
    expect(request.failures).toHaveLength(2);
    // The observed bad output, which is what a revision has to fix.
    expect(request.failures[0].output).toBe('a rambling non-summary');
  });

  it('marks a draft as unproven when it cannot be run', async () => {
    seedFailures();
    configureDraftGenerator({ drafter });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.draft).toContain('one-line summary');
    expect(result.measurement).toBeNull();
    expect(result.unavailable).toHaveLength(2);
    // A written draft is not a tested one, and the wording must not blur that.
    expect(result.summary).toMatch(/never run.*no evidence it is better/i);
    // It may say "not a tested improvement"; it may never claim one.
    expect(result.summary).not.toMatch(/scored better|is better than/i);
  });

  it('measures the draft against the prompt in use and reports the improvement', async () => {
    seedFailures();
    configureDraftGenerator({
      drafter,
      baselineExecutor: failingExecutor,
      candidateExecutorFactory: passingExecutorFactory,
    });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.measurement).not.toBeNull();
    expect(result.measurement!.comparison.verdict).toBe('improvement');
    expect(result.measurement!.comparison.improved).toEqual(['case_1', 'case_2']);
    expect(result.summary).toMatch(/scored better on the captured failures/i);
  });

  it('measures the baseline rather than assuming it failed', async () => {
    seedFailures();
    configureDraftGenerator({
      drafter,
      baselineExecutor: failingExecutor,
      candidateExecutorFactory: passingExecutorFactory,
    });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    // Without a measured "before", the "after" is a number with nothing to
    // compare against — the exact hand-waving this platform exists to remove.
    expect(result.measurement!.baselineRun.totalCases).toBe(2);
    expect(result.measurement!.baselineRun.passRate).toBe(0);
    expect(result.measurement!.candidateRun.passRate).toBe(1);
  });

  it('reports a draft that made things worse rather than hiding it', async () => {
    seedFailures();
    configureDraftGenerator({
      drafter,
      baselineExecutor: async () => ({ output: 'a short summary' }),
      candidateExecutorFactory: () => async () => ({ output: 'rambling' }),
    });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.measurement!.comparison.verdict).toBe('regression');
    // A generator that only surfaced favourable results would be selecting
    // for good news, which makes every result it reports worthless.
    expect(result.summary).toMatch(/scored worse/i);
    expect(result.summary).toMatch(/suppressing unfavourable results/i);
  });

  it('refuses to call a mixed result a win', async () => {
    seedFailures();
    let call = 0;
    configureDraftGenerator({
      drafter,
      baselineExecutor: async (input) => ({ output: input === 'summarise this' ? 'a short summary' : 'rambling' }),
      candidateExecutorFactory: () => async () => {
        call += 1;
        return { output: call === 1 ? 'rambling' : 'a short summary' };
      },
    });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.measurement!.comparison.verdict).toBe('mixed');
    expect(result.summary).toMatch(/not a clear win/i);
  });

  it('says plainly when a draft changed nothing', async () => {
    seedFailures();
    configureDraftGenerator({
      drafter,
      baselineExecutor: failingExecutor,
      candidateExecutorFactory: () => failingExecutor,
    });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.measurement!.comparison.verdict).toBe('no-change');
    expect(result.summary).toMatch(/No evidence it helps/i);
  });

  it('survives a drafter that throws', async () => {
    seedFailures();
    configureDraftGenerator({
      drafter: async () => {
        throw new Error('provider unreachable');
      },
    });

    const result = await generateDraft({ promptId: 'summarize', datasetId: 'ds' });

    expect(result.draft).toBeNull();
    expect(result.unavailable[0]).toMatch(/provider unreachable/);
  });

  it('never exposes a way to apply a draft', async () => {
    const module = await import('../draft-generator');

    // The governance boundary, asserted rather than documented: this module
    // writes text and measures text. There is no path from here to a running
    // prompt, and no export that could become one.
    expect(Object.keys(module).some((key) => /apply|deploy|activate|publish/i.test(key))).toBe(false);
  });
});
