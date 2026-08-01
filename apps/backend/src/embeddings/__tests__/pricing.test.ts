import { describe, it, expect } from 'vitest';
import { estimateEmbeddingCost } from '../pricing';

describe('estimateEmbeddingCost', () => {
  it('computes cost proportional to tokens for a known model', () => {
    const cost = estimateEmbeddingCost('text-embedding-3-small', 1000);
    expect(cost).toBeCloseTo(0.00002);
  });

  it('scales linearly with token count', () => {
    const cost500 = estimateEmbeddingCost('text-embedding-3-small', 500);
    const cost1000 = estimateEmbeddingCost('text-embedding-3-small', 1000);
    expect(cost1000).toBeCloseTo(cost500 * 2);
  });

  it('returns 0 for an unrecognized model rather than throwing', () => {
    expect(estimateEmbeddingCost('some-future-model-not-in-the-table', 1000)).toBe(0);
  });

  it('returns 0 for free-tier/local models', () => {
    expect(estimateEmbeddingCost('text-embedding-004', 1000)).toBe(0);
    expect(estimateEmbeddingCost('nomic-embed-text', 1000)).toBe(0);
  });
});
