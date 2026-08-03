import { engineeringEventBus } from './event-bus.js';

const MAX_LATENCY_SAMPLES = 1000;

interface ProviderStats {
  providerId: string;
  modelId: string;
  requests: number;
  successes: number;
  failures: number;
  latencies: number[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  errorCodes: Record<string, number>;
  lastObservedAt: number;
}

export interface ProviderMatrixEntry {
  providerId: string;
  modelId: string;
  requests: number;
  successes: number;
  failures: number;
  successRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  errorCodes: Record<string, number>;
  lastObservedAt: number;
}

const stats = new Map<string, ProviderStats>();
let unsubscribe: (() => void) | null = null;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function recordProviderObservation(obs: {
  providerId: string;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  success: boolean;
  errorCode?: string;
}): void {
  const key = `${obs.providerId}:${obs.modelId}`;
  let entry = stats.get(key);
  if (!entry) {
    entry = {
      providerId: obs.providerId,
      modelId: obs.modelId,
      requests: 0,
      successes: 0,
      failures: 0,
      latencies: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      errorCodes: {},
      lastObservedAt: 0,
    };
    stats.set(key, entry);
  }

  entry.requests += 1;
  if (obs.success) {
    entry.successes += 1;
  } else {
    entry.failures += 1;
    if (obs.errorCode) {
      entry.errorCodes[obs.errorCode] = (entry.errorCodes[obs.errorCode] ?? 0) + 1;
    }
  }
  entry.latencies.push(obs.latencyMs);
  if (entry.latencies.length > MAX_LATENCY_SAMPLES) {
    entry.latencies.splice(0, entry.latencies.length - MAX_LATENCY_SAMPLES);
  }
  entry.totalInputTokens += obs.inputTokens;
  entry.totalOutputTokens += obs.outputTokens;
  entry.totalCostCents += obs.costCents;
  entry.lastObservedAt = Date.now();
}

export function getProviderMatrix(): ProviderMatrixEntry[] {
  const matrix: ProviderMatrixEntry[] = [];
  for (const entry of stats.values()) {
    const sorted = [...entry.latencies].sort((a, b) => a - b);
    matrix.push({
      providerId: entry.providerId,
      modelId: entry.modelId,
      requests: entry.requests,
      successes: entry.successes,
      failures: entry.failures,
      successRate: entry.requests > 0 ? entry.successes / entry.requests : 0,
      p50LatencyMs: percentile(sorted, 50),
      p95LatencyMs: percentile(sorted, 95),
      totalInputTokens: entry.totalInputTokens,
      totalOutputTokens: entry.totalOutputTokens,
      totalCostCents: entry.totalCostCents,
      errorCodes: { ...entry.errorCodes },
      lastObservedAt: entry.lastObservedAt,
    });
  }
  return matrix.sort((a, b) => b.requests - a.requests);
}

export function startProviderObservatory(): void {
  if (unsubscribe) return;
  unsubscribe = engineeringEventBus.on('ai.provider.observation', (event) => {
    const p = event.payload as {
      providerId: string;
      modelId: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
      costCents: number;
      success: boolean;
      errorCode?: string;
    };
    recordProviderObservation(p);
  });
}

export function stopProviderObservatory(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  stats.clear();
}
