/**
 * Per-model cost estimates, USD per 1,000 tokens. An approximation for
 * display and for spend enforcement, never for billing/invoicing —
 * Release 2's billing system prices by credits per capability-use, not by
 * token, and is entirely separate from this.
 *
 * THE TABLE IS INCOMPLETE BY NATURE and always will be. It cannot
 * enumerate every model behind an OpenAI-compatible router, and a
 * self-hosted model has no per-token price at all. So the important
 * question is not "what does this cost?" but "do we know?" — and the two
 * exports below keep those apart:
 *
 *  - `estimateCostOrUnknown` returns `null` for a model with no price.
 *    Anything that GATES on cost must use this and handle the null.
 *  - `estimateCost` collapses that null to `0`. Safe for reporting only:
 *    an unrecognized model must never block a real conversation, so a
 *    display total degrades to what it can account for.
 *
 * Collapsing the two — which is what this module used to do — makes an
 * unpriced model indistinguishable from a free one, and a spend cap fed
 * zeros never trips.
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

/**
 * Whether this deployment can price the model at all.
 *
 * Exported so callers can ask BEFORE spending rather than discovering
 * afterwards that the answer was zero. See `estimateCostOrUnknown`.
 */
export function isPriceKnown(model: string): boolean {
  return MODEL_PRICING[model] !== undefined;
}

/**
 * Cost in USD, or `null` when this deployment has no price for the model.
 *
 * THE DISTINCTION THAT MATTERS. `estimateCost` below returns 0 for an
 * unknown model, and 0 is indistinguishable from "this was genuinely free".
 * A spend cap fed zeros never trips — so the cap silently stopped applying
 * to exactly the models most likely to be used here: anything served
 * through `SELF_HOSTED_TEXT_MODEL` or an OpenAI-compatible router, whose
 * names are not in the table above and never will be, because the table
 * cannot enumerate every model a router might expose.
 *
 * `null` forces every caller to decide what unknown means for them.
 * Returning a guessed price instead would be worse: an invented number
 * that looks authoritative in a billing ledger.
 */
export function estimateCostOrUnknown(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  return (
    (inputTokens / 1000) * pricing.inputPer1k +
    (outputTokens / 1000) * pricing.outputPer1k
  );
}

/**
 * Cost in USD, treating an unknown model as 0.
 *
 * SAFE ONLY FOR REPORTING, never for enforcement. Kept because the usage
 * ledger legitimately wants "what we can account for" and a null there
 * would break arithmetic across a mixed set of models. Anything that GATES
 * on cost must use `estimateCostOrUnknown` and handle the null.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  return estimateCostOrUnknown(model, inputTokens, outputTokens) ?? 0;
}
