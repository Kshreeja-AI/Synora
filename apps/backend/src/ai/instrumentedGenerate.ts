import { generateText } from './index';
import { AIProviderError, AIRateLimitedError } from './types';
import type { TextGenerationRequest, TextGenerationResult } from './types';
import { recordAiInteraction } from '../eos/instrumentation';
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
  opts: { workspaceId?: string } = {}
): Promise<TextGenerationResult> {
  // The budget gate runs BEFORE the try block on purpose: a budget refusal
  // is not a provider failure, and letting it fall into the catch below
  // would record it as one — sending an operator to a provider dashboard
  // for a limit the founder set.
  await assertAiBudget({ workspaceId: opts.workspaceId });

  const startedAt = Date.now();

  try {
    const result = await generateText(request);
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
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      fallbackChars: request.prompt.length + result.text.length,
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
    throw error;
  }
}
