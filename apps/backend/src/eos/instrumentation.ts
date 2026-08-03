import { engineeringEventBus } from './event-bus.js';
import type { PricingBasis } from './media-pricing.js';

/**
 * The single integration point between product code and EOS/CIEP.
 *
 * Product code calls this once when an AI interaction finishes; the
 * observatory, prompt intelligence, and case capture all subscribe
 * independently. Callers therefore never import individual collectors,
 * and adding a future subscriber requires no change to any call site.
 *
 * Nothing here can throw. Observability must never be able to fail a
 * customer-facing request, so every emission is individually guarded —
 * one failing subscriber must not prevent the others from receiving
 * their event.
 */

/**
 * Every AI capability Synora can serve. Coverage is reported against this
 * list, so a capability that exists but never instruments itself shows up
 * as a gap rather than silently vanishing from the reckoning.
 */
export const KNOWN_AI_PATHS = [
  { promptId: 'chat.generate', label: 'Chat generation' },
  { promptId: 'image.generate', label: 'Image generation' },
  { promptId: 'video.generate', label: 'Video generation' },
  { promptId: 'audio.generate', label: 'Audio generation' },
  { promptId: 'embeddings.embed', label: 'Embeddings' },
] as const;

const declaredPaths = new Set<string>();
const observedPaths = new Set<string>();

/**
 * Declares that a code path is instrumented. Called at module scope by the
 * site that instruments it, so the declaration lives next to the code it
 * describes — forgetting to instrument and forgetting to declare become the
 * same omission, rather than two that can drift apart.
 */
export function declareAiPath(promptId: string): void {
  declaredPaths.add(promptId);
}

export interface AiPathCoverage {
  promptId: string;
  label: string;
  /** The path registered itself, so it is wired to report. */
  instrumented: boolean;
  /** It has actually reported at least once in this process. */
  observed: boolean;
}

export function getAiPathCoverage(): AiPathCoverage[] {
  return KNOWN_AI_PATHS.map((path) => ({
    promptId: path.promptId,
    label: path.label,
    instrumented: declaredPaths.has(path.promptId),
    observed: observedPaths.has(path.promptId),
  }));
}

/** Clears declarations and observations. Intended for tests. */
export function resetAiPathCoverage(): void {
  declaredPaths.clear();
  observedPaths.clear();
}

export interface AiInteractionRecord {
  /** Stable identifier for the prompt under test, e.g. 'chat.generate'. */
  promptId: string;
  promptVersion?: number;
  providerId: string;
  modelId: string;
  success: boolean;
  latencyMs: number;
  /**
   * Token and cost accounting. Optional because not every capability has
   * them: image and embedding calls are not priced per token, so those
   * paths omit these rather than reporting a zero that would read as
   * "this was free". A matrix row with no token counts means the
   * capability is not token-priced, not that it cost nothing.
   */
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
  /**
   * How this call is billed. Supply it whenever the cost is not per token —
   * otherwise a per-image cost would be inferred as token pricing, and the
   * matrix would report a false basis with a perfectly real number.
   */
  pricingBasis?: PricingBasis;
  /**
   * Where `costCents` came from: 'observed' means the provider reported it,
   * 'stated' means it was derived from a published price table. A stated
   * figure is a claim about a published rate, not a measurement, and the
   * two must not become indistinguishable downstream.
   */
  costProvenance?: 'observed' | 'stated';
  errorCode?: string;
  /**
   * Interaction text. Only supply when the user has consented to
   * evaluation use — omitting it means no case can be captured, which is
   * the safe outcome. Text is redacted downstream regardless.
   */
  content?: {
    input: string;
    output: string;
    consented: boolean;
    rating?: number;
    tags?: string[];
  };
}

function safeEmit(fn: () => void): void {
  try {
    fn();
  } catch {
    // Deliberately swallowed — see the module comment.
  }
}

export function recordAiInteraction(record: AiInteractionRecord): void {
  const timestamp = Date.now();
  observedPaths.add(record.promptId);

  // Provider Capability Matrix: cost, latency, reliability per model.
  safeEmit(() =>
    engineeringEventBus.emit({
      type: 'ai.provider.observation',
      timestamp,
      source: 'instrumentation',
      payload: {
        providerId: record.providerId,
        modelId: record.modelId,
        latencyMs: record.latencyMs,
        inputTokens: record.inputTokens ?? 0,
        outputTokens: record.outputTokens ?? 0,
        costCents: record.costCents ?? 0,
        success: record.success,
        errorCode: record.errorCode,
        // An explicit basis always wins. Without this, an image call that
        // now supplies a per-image cost would be inferred as token-priced —
        // a false basis attached to a perfectly real number.
        tokenPriced: record.pricingBasis
          ? record.pricingBasis === 'token'
          : record.inputTokens !== undefined ||
            record.outputTokens !== undefined ||
            record.costCents !== undefined,
        pricingBasis: record.pricingBasis,
        costProvenance: record.costProvenance,
      },
    }),
  );

  // Prompt regression detection.
  safeEmit(() =>
    engineeringEventBus.emit({
      type: 'ai.prompt.outcome',
      timestamp,
      source: 'instrumentation',
      payload: {
        promptId: record.promptId,
        version: record.promptVersion,
        success: record.success,
        latencyMs: record.latencyMs,
        inputTokens: record.inputTokens ?? 0,
        outputTokens: record.outputTokens ?? 0,
        costCents: record.costCents ?? 0,
      },
    }),
  );

  // Evaluation case capture. Only carries text, and only when the caller
  // has established consent — the two preceding events are pure metrics
  // and carry none, so they are always safe to emit.
  if (record.content) {
    safeEmit(() =>
      engineeringEventBus.emit({
        type: 'ai.interaction.completed',
        timestamp,
        source: 'instrumentation',
        payload: {
          promptId: record.promptId,
          input: record.content!.input,
          output: record.content!.output,
          success: record.success,
          rating: record.content!.rating,
          consented: record.content!.consented,
          tags: record.content!.tags,
          note: `${record.providerId}/${record.modelId}`,
        },
      }),
    );
  }
}
