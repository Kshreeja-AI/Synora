/**
 * The resolution primitive: from a mention to a record, or to an honest
 * question — never to a guess.
 *
 * The property that matters most here is the NEGATIVE one: when not exactly
 * one candidate matches, resolution refuses to pick. A wrong guess is a
 * confident action on a record nobody named, which is the single worst
 * thing the command layer can produce, and it is worse than any question.
 */

import { describe, it, expect } from 'vitest';
import { resolveByName, nameSample } from '../resolve';

const agents = (...names: string[]) => names.map((name, i) => ({ id: `a${i}`, name }));

describe('resolveByName', () => {
  it('resolves an exact name, ignoring case and extra whitespace', () => {
    const result = resolveByName(agents('Research', 'Digest'), '  research ');
    expect(result).toEqual({ status: 'resolved', entity: { id: 'a0', name: 'Research' } });
  });

  it('resolves a name mentioned inside a longer sentence', () => {
    const result = resolveByName(
      agents('Research', 'Digest'),
      'what the research agent would do about competitor pricing'
    );
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.entity.name).toBe('Research');
  });

  it('matches whole words only — "art" is not inside "smart"', () => {
    const result = resolveByName(agents('Art'), 'preview the smart agent');
    expect(result).toEqual({ status: 'unresolved', matched: [] });
  });

  it('prefers the most specific name when one contains another', () => {
    // A person who said "digest v2" did not mean "digest", even though both
    // names technically matched the sentence.
    const result = resolveByName(agents('Digest', 'Digest v2'), 'run the digest v2 agent');
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.entity.name).toBe('Digest v2');
  });

  it('refuses to choose between two unrelated matches', () => {
    const result = resolveByName(
      agents('Sales Report', 'Sales Forecast'),
      'the sales report and sales forecast agents'
    );
    // Both genuinely named; picking either would act on a record only half
    // intended. The refusal carries both so the question can name them.
    expect(result.status).toBe('unresolved');
    if (result.status === 'unresolved') expect(result.matched).toHaveLength(2);
  });

  it('returns an empty match set when nothing was named, never a fallback pick', () => {
    const result = resolveByName(agents('Research', 'Digest'), 'do the usual thing');
    expect(result).toEqual({ status: 'unresolved', matched: [] });
  });

  it('never resolves against an empty mention', () => {
    expect(resolveByName(agents('Research'), '')).toEqual({ status: 'unresolved', matched: [] });
  });
});

describe('nameSample', () => {
  it('caps a long list and says how many more there are', () => {
    const sample = nameSample(agents('A', 'B', 'C', 'D', 'E', 'F', 'G'), 3);
    expect(sample).toBe('"A", "B", "C" and 4 more');
  });
});
