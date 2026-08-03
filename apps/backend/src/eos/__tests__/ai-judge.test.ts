/**
 * AI judge tests.
 *
 * The judge exists to measure quality rather than mere success — but it is
 * a fallible model giving an opinion, and the platform's value depends on
 * that opinion never being mistaken for a measurement. These tests hold the
 * three properties that keep the distinction: judged is labelled, absent is
 * null rather than zero, and a malfunctioning judge is discarded rather
 * than quietly clamped into a plausible number.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  configureJudge,
  isJudgeConfigured,
  judgeOutput,
  resetJudge,
  summariseJudgements,
  type Judgement,
} from '../ai-judge';
import { listGraders, applyGraders } from '../evaluation-graders';

describe('ai-judge', () => {
  beforeEach(resetJudge);

  it('is not a grader, and must never become one', () => {
    // Graders are pure and synchronous so two runs stay comparable. A
    // non-deterministic judge in that registry would destroy exactly the
    // property the evaluation platform rests on.
    expect(listGraders()).not.toContain('aiJudge');
    expect(listGraders()).not.toContain('judge');
  });

  it('reports no score, not a zero, when no judge is configured', async () => {
    expect(isJudgeConfigured()).toBe(false);

    const judgement = await judgeOutput({ output: 'a fine answer', criteria: 'is it helpful?' });

    // Zero would mark every output as bad for a reason unrelated to
    // quality, and an unjudged run would look like a quality collapse.
    expect(judgement.score).toBeNull();
    expect(judgement.unavailable).toMatch(/absent measurement, not a poor result/i);
  });

  it('labels every judgement as judged rather than measured', async () => {
    configureJudge(async () => ({ score: 0.8 }));

    const judgement = await judgeOutput({ output: 'answer', criteria: 'is it helpful?' });

    expect(judgement.provenance).toBe('judged');
    expect(judgement.score).toBe(0.8);
  });

  it('passes the criteria and context to the judge', async () => {
    const judge = vi.fn().mockResolvedValue({ score: 1, reasoning: 'complete and accurate' });
    configureJudge(judge);

    const judgement = await judgeOutput({
      output: 'Paris',
      criteria: 'names the correct capital',
      input: 'capital of France?',
      expected: 'Paris',
    });

    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({ criteria: 'names the correct capital', input: 'capital of France?' }),
    );
    expect(judgement.reasoning).toBe('complete and accurate');
  });

  it('discards an out-of-range score rather than clamping it', async () => {
    configureJudge(async () => ({ score: 7, reasoning: 'seven out of ten' }));

    const judgement = await judgeOutput({ output: 'answer', criteria: 'quality' });

    // Clamping 7 to 1 would hide a malfunctioning judge behind a perfect
    // score — the most misleading possible outcome.
    expect(judgement.score).toBeNull();
    expect(judgement.unavailable).toMatch(/out-of-range/i);
    expect(judgement.reasoning).toBe('seven out of ten');
  });

  it('discards a non-numeric or NaN score', async () => {
    configureJudge(async () => ({ score: Number.NaN }));
    expect((await judgeOutput({ output: 'a', criteria: 'c' })).score).toBeNull();

    configureJudge(async () => ({ score: 'good' as unknown as number }));
    expect((await judgeOutput({ output: 'a', criteria: 'c' })).score).toBeNull();
  });

  it('survives a judge that throws, and says what happened', async () => {
    configureJudge(async () => {
      throw new Error('provider unreachable');
    });

    const judgement = await judgeOutput({ output: 'answer', criteria: 'quality' });

    expect(judgement.score).toBeNull();
    expect(judgement.unavailable).toMatch(/provider unreachable/);
  });

  it('accepts the boundary scores', async () => {
    configureJudge(async () => ({ score: 0 }));
    expect((await judgeOutput({ output: 'a', criteria: 'c' })).score).toBe(0);

    configureJudge(async () => ({ score: 1 }));
    expect((await judgeOutput({ output: 'a', criteria: 'c' })).score).toBe(1);
  });

  it('a judged zero is distinct from an unjudged null', async () => {
    configureJudge(async () => ({ score: 0, reasoning: 'entirely wrong' }));
    const judged = await judgeOutput({ output: 'nonsense', criteria: 'accuracy' });

    resetJudge();
    const unjudged = await judgeOutput({ output: 'nonsense', criteria: 'accuracy' });

    // Same output, two very different statements: "this is bad" versus
    // "nobody looked".
    expect(judged.score).toBe(0);
    expect(judged.unavailable).toBeUndefined();
    expect(unjudged.score).toBeNull();
    expect(unjudged.unavailable).toBeDefined();
  });

  describe('summarising', () => {
    const judgement = (score: number | null, unavailable?: string): Judgement => ({
      score,
      criteria: 'quality',
      provenance: 'judged',
      unavailable,
    });

    it('averages judged outputs only, and counts the rest separately', () => {
      const summary = summariseJudgements([
        judgement(1),
        judgement(0.5),
        judgement(null, 'No judge is configured'),
      ]);

      // Folding the unjudged one in as a zero would report 0.5 instead of
      // 0.75 — dragging quality down for a reason unrelated to quality.
      expect(summary.meanScore).toBe(0.75);
      expect(summary.judged).toBe(2);
      expect(summary.unjudged).toBe(1);
    });

    it('reports a null mean rather than zero when nothing was judged', () => {
      const summary = summariseJudgements([judgement(null, 'no judge'), judgement(null, 'no judge')]);

      expect(summary.meanScore).toBeNull();
      expect(summary.judged).toBe(0);
      // Deduplicated: one reason repeated is one reason.
      expect(summary.unavailableReasons).toEqual(['no judge']);
    });

    it('keeps its provenance on the summary too', () => {
      expect(summariseJudgements([judgement(1)]).provenance).toBe('judged');
    });

    it('handles an empty set without inventing a score', () => {
      const summary = summariseJudgements([]);
      expect(summary.meanScore).toBeNull();
      expect(summary.judged).toBe(0);
      expect(summary.unjudged).toBe(0);
    });
  });

  it('never contributes to the deterministic grader score', async () => {
    configureJudge(async () => ({ score: 1 }));
    await judgeOutput({ output: 'answer', criteria: 'quality' });

    // A perfect judgement must not move a failing grader result. The two
    // dimensions are reported side by side and combined nowhere.
    const graded = applyGraders('', undefined, [{ grader: 'nonEmpty' }]);
    expect(graded.passed).toBe(false);
    expect(graded.score).toBe(0);
  });
});
