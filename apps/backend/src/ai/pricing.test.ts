import { describe, it, expect } from 'vitest'
import { estimateCost } from './pricing'

describe('estimateCost', () => {
  it('computes cost from input/output token counts for a known model', () => {
    const cost = estimateCost('claude-sonnet-5', 1000, 1000)
    // 1000 input tokens @ $0.003/1k + 1000 output tokens @ $0.015/1k
    expect(cost).toBeCloseTo(0.003 + 0.015, 10)
  })

  it('scales linearly with token count', () => {
    const single = estimateCost('claude-sonnet-5', 1000, 0)
    const double = estimateCost('claude-sonnet-5', 2000, 0)
    expect(double).toBeCloseTo(single * 2, 10)
  })

  it('returns 0 for an unrecognized model rather than throwing', () => {
    expect(estimateCost('a-model-that-does-not-exist', 1000, 1000)).toBe(0)
  })

  it('returns 0 for zero tokens', () => {
    expect(estimateCost('claude-sonnet-5', 0, 0)).toBe(0)
  })
})
