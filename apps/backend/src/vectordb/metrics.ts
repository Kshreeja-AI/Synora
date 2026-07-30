export type VectorDBOperation = 'upsert' | 'query' | 'delete';

export interface VectorDBCallRecord {
  providerId: string;
  operation: VectorDBOperation;
  latencyMs: number;
  vectorCount: number;
  success: boolean;
}

export interface VectorDBOperationMetrics {
  calls: number;
  errors: number;
  errorRate: number;
  totalVectors: number;
  avgLatencyMs: number;
}

export interface VectorDBProviderMetrics {
  upsert: VectorDBOperationMetrics;
  query: VectorDBOperationMetrics;
  delete: VectorDBOperationMetrics;
}

interface RawOperationMetrics {
  calls: number;
  errors: number;
  totalVectors: number;
  totalLatencyMs: number;
}

function emptyRaw(): RawOperationMetrics {
  return { calls: 0, errors: 0, totalVectors: 0, totalLatencyMs: 0 };
}

function summarize(raw: RawOperationMetrics): VectorDBOperationMetrics {
  return {
    calls: raw.calls,
    errors: raw.errors,
    errorRate: raw.calls > 0 ? raw.errors / raw.calls : 0,
    totalVectors: raw.totalVectors,
    avgLatencyMs: raw.calls > 0 ? raw.totalLatencyMs / raw.calls : 0,
  };
}

/**
 * In-process metrics for the vector DB subsystem: call counts, error
 * rates, vector volume, and latency, broken down per provider and per
 * operation (upsert/query/delete) — a slow query rate and a slow upsert
 * rate are different signals and shouldn't be conflated into one number.
 * Mirrors `../embeddings/metrics.ts`'s role for the embeddings subsystem.
 */
export class VectorDBMetricsCollector {
  private readonly metrics = new Map<string, Record<VectorDBOperation, RawOperationMetrics>>();

  private rawFor(providerId: string): Record<VectorDBOperation, RawOperationMetrics> {
    let raw = this.metrics.get(providerId);
    if (!raw) {
      raw = { upsert: emptyRaw(), query: emptyRaw(), delete: emptyRaw() };
      this.metrics.set(providerId, raw);
    }
    return raw;
  }

  recordCall(record: VectorDBCallRecord): void {
    const raw = this.rawFor(record.providerId)[record.operation];
    raw.calls += 1;
    if (!record.success) raw.errors += 1;
    raw.totalVectors += record.vectorCount;
    raw.totalLatencyMs += record.latencyMs;
  }

  getMetrics(providerId: string): VectorDBProviderMetrics {
    const raw = this.metrics.get(providerId) ?? { upsert: emptyRaw(), query: emptyRaw(), delete: emptyRaw() };
    return {
      upsert: summarize(raw.upsert),
      query: summarize(raw.query),
      delete: summarize(raw.delete),
    };
  }

  getAllMetrics(): Map<string, VectorDBProviderMetrics> {
    const result = new Map<string, VectorDBProviderMetrics>();
    for (const providerId of this.metrics.keys()) {
      result.set(providerId, this.getMetrics(providerId));
    }
    return result;
  }
}

let metricsCollector: VectorDBMetricsCollector | null = null;

export function getMetricsCollector(): VectorDBMetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new VectorDBMetricsCollector();
  }
  return metricsCollector;
}

export function initMetricsCollector(): VectorDBMetricsCollector {
  metricsCollector = new VectorDBMetricsCollector();
  return metricsCollector;
}

export function resetMetricsCollectorForTests(): void {
  metricsCollector = null;
}
