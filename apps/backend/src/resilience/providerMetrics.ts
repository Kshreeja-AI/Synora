/**
 * Per-provider call metrics for provider-calling stacks.
 *
 * Deliberately NOT a copy of `embeddings/metrics.ts`: that collector is
 * shaped around embeddings (cache hit rate, one token count). The text path
 * needs a distinction embeddings never had to make — the difference between
 * a call that FAILED and a call Synora REFUSED TO SEND.
 *
 * That distinction is the whole point. On credential day, "80% of calls to
 * Anthropic failed" and "80% of calls to Anthropic were never sent because
 * our own rate limit refused them" look identical in a plain error count,
 * lead to opposite diagnoses, and cost very different amounts of money. A
 * collector that cannot tell them apart would send someone hunting a
 * provider outage that never happened.
 */

export type ProviderCallOutcome =
  /** The provider answered successfully. */
  | 'success'
  /** The provider was called and the call failed (after any retries). */
  | 'failure'
  /** Never sent: Synora's own outbound rate limit refused it. */
  | 'refused-rate-limit'
  /** Never sent: the circuit breaker was open after repeated failures. */
  | 'refused-circuit-open';

/** Outcomes where no request reached the provider, so nothing was billed. */
const NEVER_SENT: ReadonlySet<ProviderCallOutcome> = new Set([
  'refused-rate-limit',
  'refused-circuit-open',
]);

export interface ProviderCallRecord {
  providerId: string;
  outcome: ProviderCallOutcome;
  /** Omitted for refusals — there is no latency to report when nothing was sent. */
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderMetrics {
  /** Every attempt, including ones never sent. */
  attempts: number;
  sent: number;
  succeeded: number;
  failed: number;
  refusedRateLimit: number;
  refusedCircuitOpen: number;
  /**
   * Failures over calls actually SENT — not over all attempts. A refusal is
   * not a provider failure, and averaging it in would understate how badly a
   * struggling provider is doing.
   */
  errorRateOfSent: number;
  /** Mean over sent calls only, for the same reason. */
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface RawMetrics {
  attempts: number;
  sent: number;
  succeeded: number;
  failed: number;
  refusedRateLimit: number;
  refusedCircuitOpen: number;
  totalLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

function emptyRaw(): RawMetrics {
  return {
    attempts: 0,
    sent: 0,
    succeeded: 0,
    failed: 0,
    refusedRateLimit: 0,
    refusedCircuitOpen: 0,
    totalLatencyMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
}

function summarize(raw: RawMetrics): ProviderMetrics {
  return {
    attempts: raw.attempts,
    sent: raw.sent,
    succeeded: raw.succeeded,
    failed: raw.failed,
    refusedRateLimit: raw.refusedRateLimit,
    refusedCircuitOpen: raw.refusedCircuitOpen,
    errorRateOfSent: raw.sent > 0 ? raw.failed / raw.sent : 0,
    avgLatencyMs: raw.sent > 0 ? raw.totalLatencyMs / raw.sent : 0,
    totalInputTokens: raw.totalInputTokens,
    totalOutputTokens: raw.totalOutputTokens,
  };
}

/**
 * In-process, per-provider. Counts reset when the process restarts and are
 * not shared across instances — this answers "what is happening in this
 * process right now", which is what an operator looking at a live incident
 * needs. Durable cross-instance aggregation is a metrics backend's job, and
 * this collector is deliberately not pretending to be one.
 */
export class ProviderMetricsCollector {
  private readonly byProvider = new Map<string, RawMetrics>();

  record(call: ProviderCallRecord): void {
    const raw = this.byProvider.get(call.providerId) ?? emptyRaw();

    raw.attempts += 1;
    if (NEVER_SENT.has(call.outcome)) {
      if (call.outcome === 'refused-rate-limit') raw.refusedRateLimit += 1;
      else raw.refusedCircuitOpen += 1;
    } else {
      raw.sent += 1;
      if (call.outcome === 'success') raw.succeeded += 1;
      else raw.failed += 1;
      raw.totalLatencyMs += call.latencyMs ?? 0;
      raw.totalInputTokens += call.inputTokens ?? 0;
      raw.totalOutputTokens += call.outputTokens ?? 0;
    }

    this.byProvider.set(call.providerId, raw);
  }

  get(providerId: string): ProviderMetrics {
    return summarize(this.byProvider.get(providerId) ?? emptyRaw());
  }

  /** Every provider seen so far, as a plain object for JSON responses. */
  snapshot(): Record<string, ProviderMetrics> {
    const out: Record<string, ProviderMetrics> = {};
    for (const [providerId, raw] of this.byProvider) {
      out[providerId] = summarize(raw);
    }
    return out;
  }
}
