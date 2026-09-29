import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyGraders,
  getGrader,
  listGraders,
  registerGrader,
  resetGraders,
} from '../evaluation-graders';

describe('evaluation-graders', () => {
  beforeEach(() => {
    resetGraders();
  });

  it('exact ignores case and whitespace runs', () => {
    const exact = getGrader('exact')!;
    expect(exact('Hello   World', 'hello world', {}).passed).toBe(true);
    expect(exact('goodbye', 'hello', {}).passed).toBe(false);
  });

  it('exact fails when no expected value is supplied', () => {
    expect(getGrader('exact')!('anything', undefined, {}).passed).toBe(false);
  });

  it('contains matches substrings', () => {
    const contains = getGrader('contains')!;
    expect(contains('the answer is 42 today', '42', {}).passed).toBe(true);
    expect(contains('no number here', '42', {}).passed).toBe(false);
  });

  it('regex matches a pattern and rejects an invalid one', () => {
    const regex = getGrader('regex')!;
    expect(regex('order-1234', undefined, { pattern: '^order-\\d+$' }).passed).toBe(true);
    expect(regex('nope', undefined, { pattern: '^order-\\d+$' }).passed).toBe(false);

    const bad = regex('x', undefined, { pattern: '([' });
    expect(bad.passed).toBe(false);
    expect(bad.detail).toContain('invalid pattern');
  });

  it('jsonValid accepts JSON and rejects prose', () => {
    const jsonValid = getGrader('jsonValid')!;
    expect(jsonValid('{"a":1}', undefined, {}).passed).toBe(true);
    expect(jsonValid('Sure! Here is your JSON: {a:1}', undefined, {}).passed).toBe(false);
  });

  it('nonEmpty rejects whitespace-only output', () => {
    const nonEmpty = getGrader('nonEmpty')!;
    expect(nonEmpty('content', undefined, {}).passed).toBe(true);
    expect(nonEmpty('   \n ', undefined, {}).passed).toBe(false);
  });

  it('lengthWithin catches truncation and runaway output', () => {
    const lengthWithin = getGrader('lengthWithin')!;
    expect(lengthWithin('abcde', undefined, { min: 3, max: 10 }).passed).toBe(true);
    expect(lengthWithin('ab', undefined, { min: 3, max: 10 }).passed).toBe(false);
    expect(lengthWithin('a'.repeat(50), undefined, { min: 3, max: 10 }).passed).toBe(false);
  });

  it('keywordCoverage awards partial credit', () => {
    const coverage = getGrader('keywordCoverage')!;
    const result = coverage('mentions alpha and beta', undefined, {
      keywords: ['alpha', 'beta', 'gamma'],
    });
    expect(result.score).toBeCloseTo(2 / 3);
    // Defaults to requiring full coverage.
    expect(result.passed).toBe(false);

    const lenient = coverage('mentions alpha and beta', undefined, {
      keywords: ['alpha', 'beta', 'gamma'],
      threshold: 0.6,
    });
    expect(lenient.passed).toBe(true);
  });

  it('combines graders into a weighted score', () => {
    const combined = applyGraders('{"ok":true}', undefined, [
      { grader: 'jsonValid', weight: 3 },
      { grader: 'nonEmpty', weight: 1 },
    ]);
    expect(combined.passed).toBe(true);
    expect(combined.score).toBe(1);
    expect(combined.results).toHaveLength(2);
  });

  it('fails overall when any single grader fails', () => {
    const combined = applyGraders('not json', undefined, [
      { grader: 'nonEmpty' },
      { grader: 'jsonValid' },
    ]);
    expect(combined.passed).toBe(false);
    expect(combined.score).toBe(0.5);
  });

  it('an unknown grader fails closed rather than being skipped', () => {
    // Silently ignoring an unknown rule would inflate the score and make
    // the whole evaluation misleading.
    const combined = applyGraders('anything', undefined, [{ grader: 'doesNotExist' }]);
    expect(combined.passed).toBe(false);
    expect(combined.score).toBe(0);
    expect(combined.results[0].detail).toContain('unknown grader');
  });

  it('an empty grader list does not pass by default', () => {
    const combined = applyGraders('anything', undefined, []);
    expect(combined.passed).toBe(false);
    expect(combined.score).toBe(0);
  });

  it('supports registering a custom grader', () => {
    registerGrader('startsWithSynora', (output) => {
      const passed = output.startsWith('Synora');
      return { passed, score: passed ? 1 : 0 };
    });

    expect(listGraders()).toContain('startsWithSynora');
    expect(applyGraders('Synora rocks', undefined, [{ grader: 'startsWithSynora' }]).passed).toBe(true);
  });

  it('resetGraders discards custom graders', () => {
    registerGrader('temporary', () => ({ passed: true, score: 1 }));
    resetGraders();
    expect(getGrader('temporary')).toBeUndefined();
    expect(getGrader('exact')).toBeDefined();
  });
});
