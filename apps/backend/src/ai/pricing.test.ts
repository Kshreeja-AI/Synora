import { describe, it, expect } from 'vitest'
import { estimateCost, estimateCostOrUnknown, isPriceKnown } from './pricing'

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

describe('unknown price is distinguishable from free', () => {
  it('returns null — not 0 — for a model with no price', () => {
    // THE distinction. `estimateCost` collapses this to 0, and 0 is
    // indistinguishable from a genuinely free call, so anything enforcing
    // a spend cap on that number would never trip for exactly the models
    // most likely to be configured here (self-hosted, or behind an
    // OpenAI-compatible router whose model names cannot be enumerated).
    expect(estimateCostOrUnknown('a-model-that-does-not-exist', 1000, 1000)).toBeNull()
    expect(estimateCost('a-model-that-does-not-exist', 1000, 1000)).toBe(0)
  })

  it('agrees with estimateCost whenever the price IS known', () => {
    // The reporting wrapper must not have drifted into a second pricing
    // implementation — it is the same number, only the unknown case differs.
    expect(estimateCostOrUnknown('claude-sonnet-5', 1500, 700)).toBe(
      estimateCost('claude-sonnet-5', 1500, 700)
    )
  })

  it('answers whether a price exists without needing token counts', () => {
    expect(isPriceKnown('claude-sonnet-5')).toBe(true)
    expect(isPriceKnown('a-model-that-does-not-exist')).toBe(false)
    // A price of genuinely zero would still be KNOWN — the question is
    // about the table, not about the amount.
    expect(isPriceKnown('gpt-4o-mini')).toBe(true)
  })
})
