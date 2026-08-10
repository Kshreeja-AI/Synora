import { describe, it, expect } from 'vitest'
import { estimateCost, estimateCostOrUnknown, isPriceKnown, normalizeModelId } from './pricing'

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

describe('gateway model-id spellings', () => {
  // The configured production router presents Anthropic's models under
  // display-style ids — `Claude Sonnet 5`, verified against its live /models
  // endpoint — while this table is keyed the way Anthropic's own API spells
  // them. Same model, same price, different punctuation; before normalisation
  // the deployment's own default model was unpriceable, which with a cost cap
  // set is the difference between generating and refusing.
  it('prices the router spelling of the configured production model', () => {
    expect(isPriceKnown('Claude Sonnet 5')).toBe(true)
    expect(estimateCostOrUnknown('Claude Sonnet 5', 1000, 1000)).toBe(
      estimateCostOrUnknown('claude-sonnet-5', 1000, 1000)
    )
  })

  it('still prices the canonical api spelling', () => {
    expect(isPriceKnown('claude-sonnet-5')).toBe(true)
  })

  it('sees through a gateway vendor prefix', () => {
    expect(isPriceKnown('anthropic/claude-sonnet-5')).toBe(true)
  })

  it('treats dots and hyphens in a version as the same thing', () => {
    // Router says `Claude Haiku 4.5`; the table says `claude-haiku-4-5`.
    expect(isPriceKnown('Claude Haiku 4.5')).toBe(true)
  })

  it('is unaffected by surrounding whitespace or casing', () => {
    expect(isPriceKnown('  CLAUDE   SONNET   5  ')).toBe(true)
  })

  // The safety boundary. Normalisation must never widen into guessing.
  it('does NOT collapse a newer version onto an older sibling price', () => {
    // `Claude Opus 4.8` normalises to claude-opus-4-8, which is absent.
    // Resolving it to `claude-opus-4` would silently bill a different model
    // at a stale rate — precisely the uncapped-bill failure this guards.
    expect(isPriceKnown('Claude Opus 4.8')).toBe(false)
    expect(estimateCostOrUnknown('Claude Opus 4.8', 1000, 1000)).toBeNull()
  })

  it('leaves a genuinely unknown model unknown', () => {
    expect(isPriceKnown('router/mystery-7b')).toBe(false)
    expect(isPriceKnown('GPT 5.6 Luna')).toBe(false)
  })

  it('normalises without inventing, so the mapping stays inspectable', () => {
    expect(normalizeModelId('Claude Sonnet 5')).toBe('claude-sonnet-5')
    expect(normalizeModelId('anthropic/Claude Sonnet 5')).toBe('claude-sonnet-5')
    expect(normalizeModelId('Claude Haiku 4.5')).toBe('claude-haiku-4-5')
    expect(normalizeModelId('GPT 5.6 Luna')).toBe('gpt-5-6-luna')
  })
})
