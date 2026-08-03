import { engineeringEventBus } from './event-bus.js';
import type { PricingBasis } from './media-pricing.js';

/**
 * Watches cost per request per provider and model, and raises an alert when
 * the recent window departs sharply from that model's own established
 * baseline.
 *
 * Three deliberate constraints:
 *
 * 1. Each model is compared only against itself. There is no table of
 *    expected prices anywhere in this file, because a hardcoded expectation
 *    is wrong the moment a provider changes its pricing and silently
 *    misleading until someone notices.
 *
 * 2. Only observations with a known pricing basis are tracked at all. A
 *    capability that reports no cost fields is excluded structurally rather
 *    than treated as costing zero — otherwise image generation would
 *    establish a baseline of nothing and every real price would look like
 *    an anomaly. Media work joins once a published price exists for it.
 *
 * 3. Nothing is claimed without enough data. Below the sample minimums the
 *    model appears in the report marked as insufficient, rather than being
 *    omitted, so a gap in coverage stays visible.
 */

const MAX_SAMPLES = 500;

interface CostStats {
  providerId: string;
  modelId: string;
  /** Cost per request, oldest first. Only token-priced observations land here. */
  samples: number[];
  requests: number;
  alerted: boolean;
  lastObservedAt: number;
}

export interface CostReportEntry {
  providerId: string;
  modelId: string;
  requests: number;
  /** Mean cost per request before the recent window. Null until enough samples exist. */
  baselineCostCents: number | null;
  /** Mean cost per request over the recent window. Null until the window is full. */
  recentCostCents: number | null;
  /** recent ÷ baseline, or null when a baseline of zero makes the ratio undefined. */
  ratio: number | null;
  baselineSamples: number;
  /**
   * False when there is not yet enough history to say anything. Reported
   * rather than hidden: "not enough data" and "no anomaly" are different
   * statements and must not look alike.
   */
  sufficientData: boolean;
  anomalous: boolean;
  lastObservedAt: number;
}

const stats = new Map<string, CostStats>();
let unsubscribe: (() => void) | null = null;
let windowSize = 10;
let minBaselineSamples = 20;
let riseMultiplier = 1.5;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface Comparison {
  baseline: number | null;
  recent: number | null;
  ratio: number | null;
  baselineSamples: number;
  sufficientData: boolean;
  anomalous: boolean;
}

function compare(entry: CostStats): Comparison {
  const baselineValues = entry.samples.slice(0, Math.max(0, entry.samples.length - windowSize));
  const recentValues = entry.samples.slice(-windowSize);

  const sufficientData =
    baselineValues.length >= minBaselineSamples && recentValues.length >= windowSize;

  if (!sufficientData) {
    return {
      baseline: null,
      recent: null,
      ratio: null,
      baselineSamples: baselineValues.length,
      sufficientData: false,
      anomalous: false,
    };
  }

  const baseline = mean(baselineValues);
  const recent = mean(recentValues);

  // A zero baseline has no meaningful multiple. Cost appearing where there
  // was none is still worth raising — a free tier ending looks exactly like
  // this — but the ratio stays null rather than becoming Infinity or 0.
  const ratio = baseline > 0 ? recent / baseline : null;
  const anomalous = baseline > 0 ? recent >= baseline * riseMultiplier : recent > 0;

  return { baseline, recent, ratio, baselineSamples: baselineValues.length, sufficientData, anomalous };
}

export function recordCostObservation(obs: {
  providerId: string;
  modelId: string;
  costCents: number;
  tokenPriced?: boolean;
  pricingBasis?: PricingBasis;
}): void {
  // Structural exclusion: a capability with no known pricing basis never
  // gets a baseline, so it can never produce a cost anomaly. Image and
  // audio work now qualifies once a published price is on record — before
  // that, it is still excluded rather than treated as free.
  if (!obs.tokenPriced && !obs.pricingBasis) return;

  const key = `${obs.providerId}:${obs.modelId}`;
  let entry = stats.get(key);
  if (!entry) {
    entry = {
      providerId: obs.providerId,
      modelId: obs.modelId,
      samples: [],
      requests: 0,
      alerted: false,
      lastObservedAt: 0,
    };
    stats.set(key, entry);
  }

  entry.requests += 1;
  entry.samples.push(obs.costCents);
  if (entry.samples.length > MAX_SAMPLES) {
    entry.samples.splice(0, entry.samples.length - MAX_SAMPLES);
  }
  entry.lastObservedAt = Date.now();

  const result = compare(entry);
  if (result.anomalous) {
    // Alert once per episode. Re-arming only after cost returns to normal
    // keeps a sustained rise from producing an alert per request.
    if (!entry.alerted) {
      entry.alerted = true;
      engineeringEventBus.emit({
        type: 'alert.cost_anomaly',
        timestamp: Date.now(),
        source: 'cost-monitor',
        payload: {
          providerId: entry.providerId,
          modelId: entry.modelId,
          baselineCostCents: result.baseline ?? 0,
          recentCostCents: result.recent ?? 0,
          ratio: result.ratio,
          baselineSamples: result.baselineSamples,
          windowSize,
        },
      });
    }
  } else {
    entry.alerted = false;
  }
}

export function getCostReport(): CostReportEntry[] {
  const report: CostReportEntry[] = [];
  for (const entry of stats.values()) {
    const result = compare(entry);
    report.push({
      providerId: entry.providerId,
      modelId: entry.modelId,
      requests: entry.requests,
      baselineCostCents: result.baseline,
      recentCostCents: result.recent,
      ratio: result.ratio,
      baselineSamples: result.baselineSamples,
      sufficientData: result.sufficientData,
      anomalous: result.anomalous,
      lastObservedAt: entry.lastObservedAt,
    });
  }
  return report.sort((a, b) => b.requests - a.requests);
}

export function startCostMonitor(
  opts: { windowSize?: number; minBaselineSamples?: number; riseMultiplier?: number } = {},
): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 10;
  minBaselineSamples = opts.minBaselineSamples ?? 20;
  riseMultiplier = opts.riseMultiplier ?? 1.5;

  unsubscribe = engineeringEventBus.on('ai.provider.observation', (event) => {
    const p = event.payload as {
      providerId: string;
      modelId: string;
      costCents: number;
      tokenPriced?: boolean;
      pricingBasis?: PricingBasis;
    };
    recordCostObservation(p);
  });
}

export function stopCostMonitor(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  stats.clear();
}
