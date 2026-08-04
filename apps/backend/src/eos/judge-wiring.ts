import { generateText } from '../ai/index.js';
import { resolveTextGenerationProvider } from '../ai/resolver.js';
import { configureJudge, isJudgeConfigured } from './ai-judge.js';
import { createModelJudge } from './model-judge.js';
import { logger } from '../utils/logger.js';

/**
 * Connects the evaluation judge to whichever text provider is configured.
 *
 * WHY THIS IS A SEPARATE MODULE. `model-judge.ts` deliberately knows
 * nothing about provider wiring — it takes a generate function. That keeps
 * it testable against fabricated model replies and unable to reach a vendor
 * even by accident. This module is the one place the two are joined, and it
 * is the only file in the judging path that imports the AI layer.
 *
 * WHY IT CHECKS BEFORE WIRING. A judge that is configured but cannot reach
 * a provider produces an unavailable judgement on every case. That is not
 * wrong — the platform reports it honestly — but it is indistinguishable
 * at a glance from a judge nobody configured, and it costs a network
 * timeout per case to discover. Resolving the provider once at startup
 * turns "silently useless" into "visibly absent".
 *
 * THREE QUALITY GATES DEPEND ON THIS. ai-quality, hallucination-rate, and
 * memory-accuracy are all unmeasured for want of a judge. Ollama makes them
 * measurable with no credentials and no spend, which is why this is worth
 * wiring before any paid provider exists — though nothing here names it.
 */
export async function wireJudgeIfProviderAvailable(): Promise<boolean> {
  if (isJudgeConfigured()) return true;

  let providerId: string;
  try {
    const provider = await resolveTextGenerationProvider();
    providerId = provider.id;
  } catch (err) {
    // No provider configured is the expected state before any credentials
    // exist. It is reported once, at info, and the gates stay unmeasured —
    // which is the truth, not a failure.
    logger.info('Evaluation judge not wired: no text generation provider is configured.', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  configureJudge(
    createModelJudge({
      generate: (request) => generateText(request),
    }),
  );

  logger.info('Evaluation judge wired.', {
    provider: providerId,
    // Named so an operator reading the log knows which gates this unblocks
    // rather than having to infer it.
    unblocks: ['ai-quality', 'hallucination-rate', 'memory-accuracy'],
  });
  return true;
}
