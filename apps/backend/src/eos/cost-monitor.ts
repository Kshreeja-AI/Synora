import { engineeringEventBus } from './event-bus.js';
import { DetectorWindow, type WindowSlices } from './detector-window.js';
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

interface CostSubject {
  providerId: string;
  modelId: string;
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

/** Windows and episode gating are shared; the comparison below is not. */
let window = new DetectorWindow<number>({ windowSize: 10, minBaselineSamples: 20 });
const subjects = new Map<string, CostSubject>();
let unsubscribe: (() => void) | null = null;
let windowSize = 10;
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

/**
 * THE COMPARISON, stated here rather than shared. Cost is unbounded, so a
 * ratio is the meaningful measure — unlike a success rate, where it is not.
 */
function compare(slices: WindowSlices<number>): Comparison {
  if (!slices.sufficientData) {
    return {
      baseline: null,
      recent: null,
      ratio: null,
      baselineSamples: slices.baselineSamples,
      sufficientData: false,
      anomalous: false,
    };
  }

  const baseline = mean(slices.baseline);
  const recent = mean(slices.recent);

  // A zero baseline has no meaningful multiple. Cost appearing where there
  // was none is still worth raising — a free tier ending looks exactly like
  // this — but the ratio stays null rather than becoming Infinity or 0.
  const ratio = baseline > 0 ? recent / baseline : null;
  const anomalous = baseline > 0 ? recent >= baseline * riseMultiplier : recent > 0;

  return {
    baseline,
    recent,
    ratio,
    baselineSamples: slices.baselineSamples,
    sufficientData: true,
    anomalous,
  };
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
  subjects.set(key, { providerId: obs.providerId, modelId: obs.modelId });

  const result = compare(window.push(key, obs.costCents));

  // Alert once per episode — the shared gate re-arms only after cost
  // returns to normal, so a sustained rise does not alert per request.
  if (window.shouldAlert(key, result.anomalous)) {
    engineeringEventBus.emit({
      type: 'alert.cost_anomaly',
      timestamp: Date.now(),
      source: 'cost-monitor',
      payload: {
        providerId: obs.providerId,
        modelId: obs.modelId,
        baselineCostCents: result.baseline ?? 0,
        recentCostCents: result.recent ?? 0,
        ratio: result.ratio,
        baselineSamples: result.baselineSamples,
        windowSize,
      },
    });
  }
}

export function getCostReport(): CostReportEntry[] {
  const report: CostReportEntry[] = [];
  for (const [key, subject] of subjects) {
    const result = compare(window.slices(key));
    report.push({
      providerId: subject.providerId,
      modelId: subject.modelId,
      requests: window.requestCount(key),
      baselineCostCents: result.baseline,
      recentCostCents: result.recent,
      ratio: result.ratio,
      baselineSamples: result.baselineSamples,
      sufficientData: result.sufficientData,
      anomalous: result.anomalous,
      lastObservedAt: window.lastObservedAt(key),
    });
  }
  return report.sort((a, b) => b.requests - a.requests);
}

export function startCostMonitor(
  opts: { windowSize?: number; minBaselineSamples?: number; riseMultiplier?: number } = {},
): void {
  if (unsubscribe) return;
  windowSize = opts.windowSize ?? 10;
  riseMultiplier = opts.riseMultiplier ?? 1.5;
  window = new DetectorWindow<number>({
    windowSize,
    minBaselineSamples: opts.minBaselineSamples ?? 20,
  });

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
  window.clear();
  subjects.clear();
}
