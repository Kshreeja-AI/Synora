import { engineeringEventBus } from './event-bus.js';
import { getLatencySnapshot } from './latency-tracker.js';
import { getErrorRateSnapshot } from './error-rate-monitor.js';
import { getProviderMatrix } from './provider-observatory.js';
import { getPromptReport } from './prompt-intelligence.js';
import {
  InMemoryHistoryStore,
  type EngineeringHistoryStore,
  type EngineeringSnapshot,
  type HistoryQuery,
} from './history-store.js';

let store: EngineeringHistoryStore = new InMemoryHistoryStore();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Swap the backing store. Called during startup to select a durable
 * implementation; defaults to in-memory so the platform works with no
 * datastore provisioned.
 */
export function setHistoryStore(next: EngineeringHistoryStore): void {
  store = next;
}

export function getHistoryStore(): EngineeringHistoryStore {
  return store;
}

/** Builds a snapshot from the live collectors without mutating any of them. */
export function buildSnapshot(): EngineeringSnapshot {
  const mem = process.memoryUsage();
  return {
    capturedAt: Date.now(),
    latency: getLatencySnapshot(),
    errorRate: getErrorRateSnapshot(),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    providers: getProviderMatrix().map((p) => ({
      providerId: p.providerId,
      modelId: p.modelId,
      requests: p.requests,
      successRate: p.successRate,
      p95LatencyMs: p.p95LatencyMs,
      totalCostCents: p.totalCostCents,
    })),
    prompts: getPromptReport().map((p) => ({
      promptId: p.promptId,
      version: p.version,
      executions: p.executions,
      successRate: p.successRate,
      p95LatencyMs: p.p95LatencyMs,
      totalCostCents: p.totalCostCents,
      regressing: p.regressing,
    })),
    eventBus: engineeringEventBus.stats(),
  };
}

/**
 * Captures and persists one snapshot. Never rejects: a failing history
 * store must not surface as an error anywhere in the platform.
 */
export async function captureSnapshot(): Promise<EngineeringSnapshot | null> {
  try {
    const snapshot = buildSnapshot();
    await store.append(snapshot);
    engineeringEventBus.emit({
      type: 'engineering.snapshot',
      timestamp: snapshot.capturedAt,
      source: 'history-recorder',
      payload: {
        store: store.kind,
        providerCount: snapshot.providers.length,
        promptCount: snapshot.prompts.length,
        regressingPrompts: snapshot.prompts.filter((p) => p.regressing).length,
      },
    });
    return snapshot;
  } catch {
    return null;
  }
}

export async function queryHistory(query?: HistoryQuery): Promise<EngineeringSnapshot[]> {
  try {
    return await store.query(query);
  } catch {
    return [];
  }
}

export function startHistoryRecorder(intervalMs = 300_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    void captureSnapshot();
  }, intervalMs);
  intervalHandle.unref?.();
}

export function stopHistoryRecorder(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
