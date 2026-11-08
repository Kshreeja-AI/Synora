import { generateText } from './index';
import { AIProviderError, AIRateLimitedError } from './types';
import type { TextGenerationRequest, TextGenerationResult } from './types';
import { recordAiInteraction } from '../eos/instrumentation';
import { attemptsMadeFor } from '../resilience/retry';
import { assertAiBudget, recordAiSpend } from './spend-guard';

/**
 * Wraps `generateText()` so a call site reports to EOS under its OWN
 * promptId, instead of either reporting to nobody or being folded into
 * `chat.generate` where it would corrupt that path's cost/latency baseline
 * (see docs/operations/PROVIDER_READINESS_MATRIX.md #14 for the full
 * reasoning). Callers still declare their own path with `declareAiPath` at
 * module scope, matching the convention every other instrumented service in
 * this codebase already follows — this function only handles the timing and
 * emission, not the declaration.
 *
 * Never throws anything `generateText()` itself wouldn't throw:
 * `recordAiInteraction` already swallows its own emission failures, so this
 * wrapper adds observability without adding a new way for a request to fail.
 */
export async function instrumentedGenerate(
  promptId: string,
  request: TextGenerationRequest,
  opts: {
    workspaceId?: string;
    userId?: string;
    /**
     * Replaces the default provider resolution. The public assistant passes
     * the free-tier chain here; everything else (budget gate, EOS emission,
     * spend recording) stays identical.
     */
    generate?: (request: TextGenerationRequest) => Promise<TextGenerationResult>;
    /**
     * The caller's own statement of what the call cost, in cents. Only for
     * paths that are free by construction (the free-tier chain). Without it
     * the guard prices by provider and model, and a model absent from the
     * price table is charged at the most expensive known rate.
     */
    knownCostCents?: number;
  } = {}
): Promise<TextGenerationResult> {
  // The budget gate runs BEFORE the try block on purpose: a budget refusal
  // is not a provider failure, and letting it fall into the catch below
  // would record it as one — sending an operator to a provider dashboard
  // for a limit the founder set.
  // `model` is forwarded so the gate can refuse an unpriceable model BEFORE
  // it spends anything. Without it the guard only learns which model ran
  // while recording the charge -- one call too late, every time.
  await assertAiBudget({
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    model: request.model,
  });

  const startedAt = Date.now();

  try {
    const result = await (opts.generate ?? generateText)(request);
    recordAiInteraction({
      promptId,
      providerId: result.provider,
      modelId: result.model,
      success: true,
      latencyMs: Date.now() - startedAt,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });
    // RAW usage across this boundary — never `?? 0`. Absent counts trigger
    // the guard's estimated floor, keeping unknown distinguishable from
    // free (which matters exactly on the self-hosted path, where usage
    // reporting is unreliable).
    await recordAiSpend({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      fallbackChars: request.prompt.length + result.text.length,
      knownCostCents: opts.knownCostCents,
    });
    return result;
  } catch (error) {
    // Our own error types carry the provider they came from, even when the
    // call never reached a model (a rate-limit refusal, a mid-call
    // failure) — reusing that is more honest than defaulting to 'unknown'
    // when the information already exists.
    const providerId =
      error instanceof AIProviderError || error instanceof AIRateLimitedError
        ? error.providerId
        : 'unknown';

    recordAiInteraction({
      promptId,
      providerId,
      modelId: 'unknown',
      success: false,
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'unknown',
    });

    // A FAILED CALL IS NOT NECESSARILY A FREE CALL.
    //
    // `withTimeout` bounds how long Synora waits; it cannot cancel the
    // upstream request (see its own header), so a timed-out generation may
    // complete and bill anyway — and the retry layer then tries again, up
    // to three times. Recording nothing here made a timeout storm free
    // forever as far as the cap was concerned: real money spent, zero
    // counted, and the limit never binding no matter how long it ran.
    //
    // Only timeout-class failures are charged. A refused connection or a
    // 429 never reached a model, and charging those would refuse callers
    // for spend that demonstrably did not happen.
    if (mayHaveBilled(error)) {
      const attempts = attemptsMadeFor(error) ?? 1;
      await recordAiSpend({
        workspaceId: opts.workspaceId,
        userId: opts.userId,
        provider: providerId,
        model: request.model ?? 'unknown',
        // A FLOOR, and knowingly one: the response was abandoned, so its
        // output length is unknowable and only the prompt can be measured.
        // It under-counts, which is the acceptable direction — the
        // alternative in production was counting zero.
        fallbackChars: request.prompt.length * attempts,
        knownCostCents: opts.knownCostCents,
      });
    }
    throw error;
  }
}

/**
 * Whether a failure could have left a bill behind.
 *
 * A timeout means Synora stopped waiting, NOT that the provider stopped
 * generating. Everything else in the retryable set — connection refused,
 * host unreachable, a 429 — failed before a model ran.
 */
function mayHaveBilled(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('timeout') || message.includes('etimedout');
}
