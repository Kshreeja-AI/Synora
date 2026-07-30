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
