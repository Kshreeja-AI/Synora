/**
 * Per-model cost estimates, USD per 1,000 tokens.
 *
 * TWO CALLERS WITH OPPOSITE NEEDS, so this file exposes two functions and
 * they must not be confused:
 *
 *  - `estimateCost` populates `ConversationUsage.estimatedCost` — a figure
 *    for display, never for billing/invoicing (Release 2's billing prices
 *    by credits per capability-use and is entirely separate). An
 *    unrecognized model returns `0` rather than throwing, because a missing
 *    price entry must never break a working conversation.
 *
 *  - `priceModelUsd` answers the SPENDING CAP's question, and reports
 *    "unknown" as its own outcome. For a cap, "unrecognized model" costing
 *    zero is not a harmless approximation — it is an uncapped bill.
 *
 * This table is best-effort and will always lag the providers. That is
 * precisely why the metered path is built to fail closed on absence rather
 * than to trust the table's completeness.
 */

interface ModelPricing {
  readonly inputPer1k: number;
  readonly outputPer1k: number;
}

const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-sonnet-5': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-opus-4': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-haiku-4-5': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  return (
    (inputTokens / 1000) * pricing.inputPer1k +
    (outputTokens / 1000) * pricing.outputPer1k
  );
}

/**
 * The same arithmetic, but SAYING SO when the price is unknown.
 *
 * WHY THIS EXISTS SEPARATELY FROM `estimateCost`. That function answers a
 * display question — "roughly what did this conversation cost?" — and
 * returning 0 for an unrecognized model is the right answer there, because
 * a missing price entry must never break a working conversation.
 *
 * A SPENDING CAP ASKS A DIFFERENT QUESTION, and the same answer is
 * catastrophic for it: a model absent from the table would cost 0 cents
 * forever, so a dollar cap would never bind it. That is not hypothetical —
 * `ANTHROPIC_MODEL` is free-form env configuration, and a perfectly normal
 * value like a dated snapshot (`claude-sonnet-5-20250514`) is not a key in
 * this table. Someone who set a $5/day cap and a real model name would have
 * no cap at all.
 *
 * So the caller is forced to handle "unknown" rather than being handed a
 * number that silently means "free". Callers that meter money must fail
 * closed; callers that render a figure may keep showing zero.
 */
export type ModelPriceResult =
  | { known: true; costUsd: number }
  | { known: false };

export function priceModelUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): ModelPriceResult {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return { known: false };

  return {
    known: true,
    costUsd:
      (inputTokens / 1000) * pricing.inputPer1k +
      (outputTokens / 1000) * pricing.outputPer1k,
  };
}

/**
 * `priceModelUsd` in the two shapes callers actually want.
 *
 * Both are thin wrappers rather than separate arithmetic, so there is exactly
 * one place where a price is computed and exactly one table to keep correct.
 * They exist because "is this priceable?" and "what does it cost, or nothing
 * if I cannot say?" are the two questions the spend guard and its tests ask,
 * and expressing them through the tagged union at every call site obscured
 * what was being asked.
 */
export function estimateCostOrUnknown(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const priced = priceModelUsd(model, inputTokens, outputTokens);
  return priced.known ? priced.costUsd : null;
}

/** Whether this deployment can put a number on the model at all. */
export function isPriceKnown(model: string): boolean {
  return priceModelUsd(model, 0, 0).known;
}

/**
 * The most expensive rate this table knows, used as the ceiling charged to
 * a metered model whose price is unknown.
 *
 * DERIVED, never hardcoded: a hardcoded ceiling silently stops being a
 * ceiling the day a pricier model is added, and nothing would fail to say
 * so. Deliberately pessimistic — over-charging an unpriced model refuses a
 * caller slightly early, which is recoverable, while under-charging it
 * spends money that is not.
 */
export function maxKnownRatePer1k(): { inputPer1k: number; outputPer1k: number } {
  const entries = Object.values(MODEL_PRICING);
  return {
    inputPer1k: Math.max(...entries.map((p) => p.inputPer1k)),
    outputPer1k: Math.max(...entries.map((p) => p.outputPer1k)),
  };
}
