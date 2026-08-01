/**
 * Per-model cost estimates, USD per 1,000 tokens. Used only to populate
 * `ConversationUsage.estimatedCost` — an approximation for display, never
 * used for billing/invoicing (Release 2's billing system prices by credits
 * per capability-use, not by token, and is entirely separate from this).
 *
 * An unrecognized model is not an error: `estimateCost` returns `0` rather
 * than throwing, because a conversation must keep working even for a model
 * this table doesn't yet know the price of — a missing price entry should
 * never block a real conversation.
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
