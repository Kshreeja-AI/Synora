/**
 * Model-backed judge tests.
 *
 * Almost all of the risk in this module is in parsing. A model asked for a
 * number will sometimes answer with prose, a different scale, or a refusal,
 * and the difference between "the output was bad" and "we could not read
 * the judgement" is the difference between a product problem and a tooling
 * problem. These tests exist to keep those two apart.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgePrompt,
  createModelJudge,
  parseJudgeScore,
} from '../model-judge';
import { judgeOutput, configureJudge, resetJudge } from '../ai-judge';

describe('parseJudgeScore', () => {
  describe('accepts an unambiguous score', () => {
    it.each([
      ['0.8', 0.8],
      ['1', 1],
      ['0', 0],
      ['.75', 0.75],
      ['  0.42  ', 0.42],
      ['80%', 0.8],
      ['100%', 1],
      ['0%', 0],
    ])('reads %s', (reply, expected) => {
      expect(parseJudgeScore(reply)).toBeCloseTo(expected, 5);
    });
  });

  describe('refuses rather than guessing', () => {
    it('refuses a number buried in prose', () => {
      // The trap. "8 out of 10" contains a number, and reading it as 8.0 —
      // or rescaling to 0.8 by assuming the scale — is a confident wrong
      // answer. Which is worse than no answer.
      expect(() => parseJudgeScore('This is a solid 8 out of 10 effort.')).toThrow(
        /not a bare score/i,
      );
      expect(() => parseJudgeScore('Score: 0.9')).toThrow(/not a bare score/i);
    });

    it('refuses an out-of-range number instead of rescaling it', () => {
      // 8 might mean 8/10. It might mean the model ignored the scale
      // entirely. Guessing which would fabricate the measurement.
      expect(() => parseJudgeScore('8')).toThrow(/outside 0\.\.1/);
      expect(() => parseJudgeScore('95')).toThrow(/outside 0\.\.1/);
      expect(() => parseJudgeScore('150%')).toThrow(/out-of-range percentage/);
    });

    it('honours an explicit refusal from the judge', () => {
      expect(() => parseJudgeScore('UNSCORABLE')).toThrow(/declined to score/i);
      expect(() => parseJudgeScore('unscorable')).toThrow(/declined to score/i);
    });

    it('refuses an empty or non-numeric reply', () => {
      expect(() => parseJudgeScore('')).toThrow(/empty reply/i);
      expect(() => parseJudgeScore('   ')).toThrow(/empty reply/i);
      expect(() => parseJudgeScore('I cannot help with that request.')).toThrow(
        /not a bare score/i,
      );
    });
  });
});

describe('the judge prompt', () => {
  it('demands a bare decimal and offers a way to refuse', () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/single decimal number between 0 and 1/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/UNSCORABLE/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/do not explain/i);
  });

  it('includes criteria and output, and omits absent optional context', () => {
    const prompt = buildJudgePrompt({ output: 'the answer', criteria: 'must be concise' });

    expect(prompt).toContain('must be concise');
    expect(prompt).toContain('the answer');
    expect(prompt).not.toContain('REFERENCE ANSWER');
    expect(prompt).not.toContain('INPUT GIVEN');
  });

  it('includes input and reference answer when supplied', () => {
    const prompt = buildJudgePrompt({
      output: 'Paris',
      criteria: 'factually correct',
      input: 'Capital of France?',
      expected: 'Paris',
    });

    expect(prompt).toContain('Capital of France?');
    expect(prompt).toContain('REFERENCE ANSWER');
  });
});

describe('createModelJudge', () => {
  it('asks the model at temperature 0 by default', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '0.9' });
    const judge = createModelJudge({ generate });

    const result = await judge({ output: 'x', criteria: 'y' });

    expect(result.score).toBe(0.9);
    // A judge is not being asked to be creative; lower variance keeps two
    // runs of the same evaluation closer to comparable.
    expect(generate.mock.calls[0][0].temperature).toBe(0);
    expect(generate.mock.calls[0][0].systemPrompt).toBe(JUDGE_SYSTEM_PROMPT);
  });

  it('caps output tokens, so a rambling reply fails fast and cheap', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '0.5' });
    await createModelJudge({ generate })({ output: 'x', criteria: 'y' });

    expect(generate.mock.calls[0][0].maxTokens).toBeLessThanOrEqual(32);
  });

  it('keeps the raw reply as reasoning, including when it is unusable', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '0.7' });
    const result = await createModelJudge({ generate })({ output: 'x', criteria: 'y' });

    expect(result.reasoning).toBe('0.7');
  });

  it('names no provider — the generator is injected', () => {
    // Provider neutrality is structural here: this module cannot reach a
    // vendor even if someone wanted it to.
    const source = createModelJudge.toString();
    for (const vendor of ['ollama', 'openai', 'anthropic', 'gemini']) {
      expect(source.toLowerCase()).not.toContain(vendor);
    }
  });
});

describe('integration with judgeOutput', () => {
  it('an unreadable judgement is unavailable, never zero', async () => {
    // The property this whole module is arranged around. A malfunctioning
    // judge must not look like a failing product.
    configureJudge(createModelJudge({ generate: async () => ({ text: 'looks good to me!' }) }));

    const judgement = await judgeOutput({ output: 'x', criteria: 'is it good?' });

    expect(judgement.score).toBeNull();
    expect(judgement.score).not.toBe(0);
    expect(judgement.unavailable).toMatch(/not a bare score/i);
    expect(judgement.provenance).toBe('judged');
    resetJudge();
  });

  it('a real score is carried through with judged provenance', async () => {
    configureJudge(createModelJudge({ generate: async () => ({ text: '0.85' }) }));

    const judgement = await judgeOutput({ output: 'x', criteria: 'is it good?' });

    expect(judgement.score).toBe(0.85);
    expect(judgement.unavailable).toBeUndefined();
    // Never 'measured'. A judged score is an opinion from a fallible model.
    expect(judgement.provenance).toBe('judged');
    resetJudge();
  });

  it('a judge that throws is unavailable, not a crash and not a zero', async () => {
    configureJudge(
      createModelJudge({
        generate: async () => {
          throw new Error('connection refused');
        },
      }),
    );

    const judgement = await judgeOutput({ output: 'x', criteria: 'y' });

    expect(judgement.score).toBeNull();
    expect(judgement.unavailable).toMatch(/connection refused/i);
    resetJudge();
  });
});
