export interface EmbeddingCallRecord {
  providerId: string;
  latencyMs: number;
  tokens: number;
  cacheHit: boolean;
  success: boolean;
}

export interface EmbeddingProviderMetrics {
  calls: number;
  errors: number;
  errorRate: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  totalTokens: number;
  avgLatencyMs: number;
}

interface RawProviderMetrics {
  calls: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
  totalTokens: number;
  totalLatencyMs: number;
}

function emptyRawMetrics(): RawProviderMetrics {
  return { calls: 0, errors: 0, cacheHits: 0, cacheMisses: 0, totalTokens: 0, totalLatencyMs: 0 };
}

function summarize(raw: RawProviderMetrics): EmbeddingProviderMetrics {
  const cacheable = raw.cacheHits + raw.cacheMisses;
  return {
    calls: raw.calls,
    errors: raw.errors,
    errorRate: raw.calls > 0 ? raw.errors / raw.calls : 0,
    cacheHits: raw.cacheHits,
    cacheMisses: raw.cacheMisses,
    cacheHitRate: cacheable > 0 ? raw.cacheHits / cacheable : 0,
    totalTokens: raw.totalTokens,
    avgLatencyMs: raw.calls > 0 ? raw.totalLatencyMs / raw.calls : 0,
  };
}

/**
 * In-process metrics for the embeddings subsystem: call counts, error
 * rates, cache effectiveness, token volume, and latency, all broken down
 * per provider. Intended to back a `/health` or `/metrics` endpoint the
 * same way `../queue/metrics.ts` does for the queue subsystem — this
 * module only collects; exposing it over HTTP is left to the caller.
 */
export class EmbeddingMetricsCollector {
  private readonly metrics = new Map<string, RawProviderMetrics>();

  recordCall(record: EmbeddingCallRecord): void {
    const raw = this.metrics.get(record.providerId) ?? emptyRawMetrics();

    raw.calls += 1;
    if (!record.success) raw.errors += 1;
    if (record.cacheHit) raw.cacheHits += 1;
    else raw.cacheMisses += 1;
    raw.totalTokens += record.tokens;
    raw.totalLatencyMs += record.latencyMs;

    this.metrics.set(record.providerId, raw);
  }

  getMetrics(providerId: string): EmbeddingProviderMetrics {
    return summarize(this.metrics.get(providerId) ?? emptyRawMetrics());
  }

  getAllMetrics(): Map<string, EmbeddingProviderMetrics> {
    const result = new Map<string, EmbeddingProviderMetrics>();
    for (const [providerId, raw] of this.metrics) {
      result.set(providerId, summarize(raw));
    }
    return result;
  }
}

let metricsCollector: EmbeddingMetricsCollector | null = null;

export function getMetricsCollector(): EmbeddingMetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new EmbeddingMetricsCollector();
  }
  return metricsCollector;
}

export function initMetricsCollector(): EmbeddingMetricsCollector {
  metricsCollector = new EmbeddingMetricsCollector();
  return metricsCollector;
}

export function resetMetricsCollectorForTests(): void {
  metricsCollector = null;
}
