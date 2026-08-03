import { engineeringEventBus } from './event-bus.js';

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
