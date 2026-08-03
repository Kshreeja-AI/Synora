import { engineeringEventBus } from './event-bus.js';

const MAX_LATENCY_SAMPLES = 1000;

interface PromptStats {
  promptId: string;
  version: number;
  executions: number;
  successes: number;
  failures: number;
  latencies: number[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  recentOutcomes: boolean[];
  regressionAlerted: boolean;
  lastObservedAt: number;
}

export interface PromptReportEntry {
  promptId: string;
  version: number;
  executions: number;
  successes: number;
  failures: number;
  successRate: number;
  recentSuccessRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostCents: number;
  regressing: boolean;
  lastObservedAt: number;
}

const stats = new Map<string, PromptStats>();
let unsubscribe: (() => void) | null = null;
let windowSize = 20;
let dropThreshold = 0.3;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function recentRate(entry: PromptStats): number {
  if (entry.recentOutcomes.length === 0) return 0;
  const ok = entry.recentOutcomes.filter(Boolean).length;
  return ok / entry.recentOutcomes.length;
}

function isRegressing(entry: PromptStats): boolean {
  if (entry.recentOutcomes.length < windowSize) return false;
  const overall = entry.executions > 0 ? entry.successes / entry.executions : 0;
  return recentRate(entry) < overall - dropThreshold;
}

export function recordPromptOutcome(outcome: {
  promptId: string;
  version?: number;
  success: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}): void {
  const version = outcome.version ?? 1;
  const key = `${outcome.promptId}:v${version}`;
  let entry = stats.get(key);
  if (!entry) {
    entry = {
      promptId: outcome.promptId,
      version,
      executions: 0,
      successes: 0,
      failures: 0,
      latencies: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      recentOutcomes: [],
      regressionAlerted: false,
      lastObservedAt: 0,
    };
    stats.set(key, entry);
  }

  entry.executions += 1;
  if (outcome.success) {
    entry.successes += 1;
  } else {
    entry.failures += 1;
  }
  entry.latencies.push(outcome.latencyMs);
  if (entry.latencies.length > MAX_LATENCY_SAMPLES) {
    entry.latencies.splice(0, entry.latencies.length - MAX_LATENCY_SAMPLES);
  }
  entry.totalInputTokens += outcome.inputTokens ?? 0;
  entry.totalOutputTokens += outcome.outputTokens ?? 0;
  entry.totalCostCents += outcome.costCents ?? 0;
  entry.recentOutcomes.push(outcome.success);
  if (entry.recentOutcomes.length > windowSize) {
    entry.recentOutcomes.splice(0, entry.recentOutcomes.length - windowSize);
  }
  entry.lastObservedAt = Date.now();

  if (isRegressing(entry)) {
    if (!entry.regressionAlerted) {
      entry.regressionAlerted = true;
      engineeringEventBus.emit({
        type: 'alert.prompt_regression',
        timestamp: Date.now(),
        source: 'prompt-intelligence',
        payload: {
          promptId: entry.promptId,
          version: entry.version,
          overallSuccessRate: entry.successes / entry.executions,
          recentSuccessRate: recentRate(entry),
          windowSize,
        },
      });
    }
  } else {
    entry.regressionAlerted = false;
  }
}

export function getPromptReport(): PromptReportEntry[] {
  const report: PromptReportEntry[] = [];
  for (const entry of stats.values()) {
    const sorted = [...entry.latencies].sort((a, b) => a - b);
    report.push({
      promptId: entry.promptId,
      version: entry.version,
      executions: entry.executions,
      successes: entry.successes,
      failures: entry.failures,
      successRate: entry.executions > 0 ? entry.successes / entry.executions : 0,
      recentSuccessRate: recentRate(entry),
      p50LatencyMs: percentile(sorted, 50),
      p95LatencyMs: percentile(sorted, 95),
      avgInputTokens: entry.executions > 0 ? Math.round(entry.totalInputTokens / entry.executions) : 0,
      avgOutputTokens: entry.executions > 0 ? Math.round(entry.totalOutputTokens / entry.executions) : 0,
      totalCostCents: entry.totalCostCents,
      regressing: isRegressing(entry),
      lastObservedAt: entry.lastObservedAt,
    });
  }
  return report.sort((a, b) => b.executions - a.executions);
}

export function startPromptIntelligence(opts: { windowSize?: number; dropThreshold?: number } = {}): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 20;
  dropThreshold = opts.dropThreshold ?? 0.3;
  unsubscribe = engineeringEventBus.on('ai.prompt.outcome', (event) => {
    const p = event.payload as {
      promptId: string;
      version?: number;
      success: boolean;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      costCents?: number;
    };
    recordPromptOutcome(p);
  });
}

export function stopPromptIntelligence(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  stats.clear();
}
