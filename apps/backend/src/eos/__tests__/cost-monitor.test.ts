import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  recordCostObservation,
  getCostReport,
  startCostMonitor,
  stopCostMonitor,
} from '../cost-monitor';
import { recordAiInteraction } from '../instrumentation';

const model = { providerId: 'anthropic', modelId: 'claude-x' };

/** Feeds n observations at a fixed cost per request. */
function feed(costCents: number, n: number, overrides: Partial<Parameters<typeof recordCostObservation>[0]> = {}) {
  for (let i = 0; i < n; i++) {
    recordCostObservation({ ...model, costCents, tokenPriced: true, ...overrides });
  }
}

describe('cost-monitor', () => {
  beforeEach(() => {
    stopCostMonitor();
  });

  it('says nothing until it has enough history to say anything', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    // A tenfold rise, but on five requests total. Not enough to claim a trend.
    feed(1, 5);
    feed(10, 5);

    expect(alerts).toHaveLength(0);
    const [entry] = getCostReport();
    expect(entry.sufficientData).toBe(false);
    // Null, not zero: the baseline was never established, as distinct from
    // being measured at zero.
    expect(entry.baselineCostCents).toBeNull();
    unsub();
  });

  it('alerts when cost per request rises sharply against its own baseline', () => {
    const alerts: Array<{ payload: Record<string, unknown> }> = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) =>
      alerts.push(e as { payload: Record<string, unknown> }),
    );
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20, riseMultiplier: 1.5 });

    feed(2, 25);
    feed(6, 5);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.providerId).toBe('anthropic');
    expect(alerts[0].payload.baselineCostCents).toBe(2);
    // It fires the moment the rolling window crosses the threshold — here on
    // the second expensive request, when the window reads [2,2,2,6,6] and
    // averages 3.6, i.e. 1.8× the baseline. Waiting for the window to fill
    // with expensive requests would delay every alert by a full window.
    expect(alerts[0].payload.recentCostCents).toBe(3.6);
    expect(alerts[0].payload.ratio).toBe(1.8);
    unsub();
  });

  it('does not alert on a rise below the multiplier', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20, riseMultiplier: 1.5 });

    feed(2, 25);
    feed(2.8, 5); // 1.4× — real, but within normal variation

    expect(alerts).toHaveLength(0);
    unsub();
  });

  it('never alerts on a fall in cost', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    feed(10, 25);
    feed(1, 5);

    // Getting cheaper is not a problem to escalate to the founder.
    expect(alerts).toHaveLength(0);
    unsub();
  });

  it('reports a null ratio rather than infinity when the baseline was free', () => {
    const alerts: Array<{ payload: Record<string, unknown> }> = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) =>
      alerts.push(e as { payload: Record<string, unknown> }),
    );
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    feed(0, 25);
    feed(3, 5);

    // Cost appearing where there was none is worth raising — a free tier
    // ending looks exactly like this — but it is not a multiple of anything.
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.ratio).toBeNull();
    expect(alerts[0].payload.baselineCostCents).toBe(0);
    unsub();
  });

  it('alerts once per episode, not once per request', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    feed(2, 25);
    feed(20, 30); // sustained, not a blip

    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('re-arms after cost returns to normal', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    feed(2, 25);
    feed(20, 5);
    expect(alerts).toHaveLength(1);

    feed(2, 10); // back to normal — alert clears
    feed(20, 5); // and rises again
    expect(alerts).toHaveLength(2);
    unsub();
  });

  it('ignores capabilities that report no cost at all', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    // Image generation supplies no cost fields. Treating that as "costs
    // zero" would give it a baseline of nothing, and every real price would
    // then read as an infinite rise.
    for (let i = 0; i < 50; i++) {
      recordCostObservation({ providerId: 'openai', modelId: 'gpt-image-1', costCents: 0 });
    }

    expect(alerts).toHaveLength(0);
    expect(getCostReport()).toHaveLength(0);
    unsub();
  });

  it('tracks each model separately', () => {
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    feed(2, 30);
    for (let i = 0; i < 30; i++) {
      recordCostObservation({ providerId: 'openai', modelId: 'gpt-x', costCents: 9, tokenPriced: true });
    }

    const report = getCostReport();
    expect(report).toHaveLength(2);
    // A cheap model must not be dragged into an anomaly by an expensive one.
    expect(report.every((r) => !r.anomalous)).toBe(true);
  });

  it('picks up cost from real AI traffic end to end', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    const base = {
      promptId: 'chat.generate',
      providerId: 'anthropic',
      modelId: 'claude-y',
      success: true,
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 10,
    };
    for (let i = 0; i < 25; i++) recordAiInteraction({ ...base, costCents: 2 });
    for (let i = 0; i < 5; i++) recordAiInteraction({ ...base, costCents: 8 });

    // Proves the wiring, not just the arithmetic: product code calls one
    // function and the cost monitor hears about it.
    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('startCostMonitor is idempotent', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.cost_anomaly', (e) => alerts.push(e));
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

    const base = {
      promptId: 'chat.generate',
      providerId: 'anthropic',
      modelId: 'claude-z',
      success: true,
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 10,
    };
    for (let i = 0; i < 25; i++) recordAiInteraction({ ...base, costCents: 2 });
    for (let i = 0; i < 5; i++) recordAiInteraction({ ...base, costCents: 8 });

    // A duplicate subscription would count every request twice and shift
    // the baseline underneath the comparison.
    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('a throwing subscriber never propagates to the caller', () => {
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });
    const unsub = engineeringEventBus.on('alert.cost_anomaly', () => {
      throw new Error('subscriber exploded');
    });

    feed(2, 25);
    expect(() => feed(20, 5)).toThrow(); // the bus surfaces it here…
    unsub();

    // …but instrumentation guards the product-facing path, which is the one
    // that must never fail a customer request.
    startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });
    const boom = engineeringEventBus.on('ai.provider.observation', () => {
      throw new Error('boom');
    });
    expect(() =>
      recordAiInteraction({
        promptId: 'chat.generate',
        providerId: 'anthropic',
        modelId: 'claude-guard',
        success: true,
        latencyMs: 1,
        costCents: 1,
      }),
    ).not.toThrow();
    boom();
  });
});
