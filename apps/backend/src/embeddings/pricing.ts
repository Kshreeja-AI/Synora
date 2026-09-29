/**
 * Per-model cost estimates, USD per 1,000 tokens, for the embeddings
 * subsystem. Mirrors `../ai/pricing.ts`'s posture exactly: this is an
 * approximation for display in usage/cost dashboards, never used for
 * billing enforcement (Release 2's billing system prices by credits per
 * capability-use, entirely separate from this).
 *
 * An unrecognized model is not an error: `estimateEmbeddingCost` returns
 * `0` rather than throwing, because embedding a document must keep working
 * even for a model this table doesn't yet know the price of.
 */

const MODEL_PRICING_PER_1K: Readonly<Record<string, number>> = {
  'text-embedding-3-small': 0.00002,
  'text-embedding-3-large': 0.00013,
  'text-embedding-ada-002': 0.0001,
  'voyage-3': 0.00006,
  'voyage-3-lite': 0.00002,
  'voyage-code-3': 0.00006,
  'embed-english-v3.0': 0.0001,
  'embed-multilingual-v3.0': 0.0001,
  // Google's Generative Language API embeddings are free-tier-eligible and
  // priced separately from token-metered generation; 0 here reflects that
  // there is no per-token line item to estimate, not that a price lookup
  // failed.
  'text-embedding-004': 0,
  // Self-hosted/local inference (Ollama, self-hosted OpenAI-compatible
  // servers) has no per-token API cost — compute cost is infrastructure,
  // not a metered API charge this table can price.
  'nomic-embed-text': 0,
};

export function estimateEmbeddingCost(model: string, tokens: number): number {
  const pricePer1k = MODEL_PRICING_PER_1K[model];
  if (pricePer1k === undefined) return 0;
  return (tokens / 1000) * pricePer1k;
}

/**
 * The spend-cap's view of embedding cost: the same table, but UNKNOWN is a
 * ceiling, never zero.
 *
 * `estimateEmbeddingCost` above keeps returning 0 for an unknown model —
 * right for its display/usage-report callers, and exactly wrong for a cap,
 * where "nobody priced it" as "free" is an unbounded bill. The ceiling is
 * the most expensive rate THIS table knows (an embedding-scale number, ~50×
 * cheaper per token than frontier text), so an unpriced embedding model is
 * charged conservatively within its own workload class rather than at a
 * fantasy text-generation rate. Zero-priced entries (Gemini's free tier)
 * are KNOWN zeros and stay free.
 */
export function embeddingCostCentsForCap(
  model: string,
  tokens: number
): { costCents: number; unpriced: boolean } {
  const pricePer1k = MODEL_PRICING_PER_1K[model];
  if (pricePer1k !== undefined) {
    return { costCents: Math.ceil((tokens / 1000) * pricePer1k * 100), unpriced: false };
  }
  const ceilingPer1k = Math.max(...Object.values(MODEL_PRICING_PER_1K));
  return { costCents: Math.ceil((tokens / 1000) * ceilingPer1k * 100), unpriced: true };
}
