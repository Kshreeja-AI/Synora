import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  recordLatencyObservation,
  getLatencyDriftReport,
  startLatencyDrift,
  stopLatencyDrift,
} from '../latency-drift';
import { recordAiInteraction } from '../instrumentation';
import { buildLatencyDriftProposal, startProposalEngine, stopProposalEngine, listProposals } from '../proposal-engine';

const model = { providerId: 'anthropic', modelId: 'claude-x' };

function feed(latencyMs: number, n: number) {
  for (let i = 0; i < n; i++) recordLatencyObservation({ ...model, latencyMs });
}

describe('latency-drift', () => {
  beforeEach(() => {
    stopLatencyDrift();
    stopProposalEngine();
  });

  it('says nothing until it has enough history', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    feed(100, 5);
    feed(2000, 5);

    expect(alerts).toHaveLength(0);
    const [entry] = getLatencyDriftReport();
    // Null, not zero: no baseline was ever established.
    expect(entry.sufficientData).toBe(false);
    expect(entry.baselineP95Ms).toBeNull();
    unsub();
  });

  it('alerts when the recent window is materially slower', () => {
    const alerts: Array<{ payload: Record<string, unknown> }> = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) =>
      alerts.push(e as { payload: Record<string, unknown> }),
    );
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30, slowdownMultiplier: 1.5 });

    feed(100, 35);
    feed(400, 5);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.baselineP95Ms).toBe(100);
    unsub();
  });

  it('never alerts on getting faster', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    feed(1000, 35);
    feed(50, 5);

    expect(alerts).toHaveLength(0);
    unsub();
  });

  it('watches the tail, where a mean would hide the problem', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 20, minBaselineSamples: 40, slowdownMultiplier: 1.5 });

    // Baseline: fast with a mild tail. p95 lands around 200.
    for (let i = 0; i < 60; i++) recordLatencyObservation({ ...model, latencyMs: i % 20 === 0 ? 200 : 100 });
    // Recent: same typical speed, far worse tail. The mean barely moves;
    // the experience of one call in twenty is five times worse.
    for (let i = 0; i < 20; i++) recordLatencyObservation({ ...model, latencyMs: i % 20 === 0 ? 100 : 1000 });

    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('reports a null ratio rather than infinity when the baseline was zero', () => {
    const alerts: Array<{ payload: Record<string, unknown> }> = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) =>
      alerts.push(e as { payload: Record<string, unknown> }),
    );
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    feed(0, 35);
    feed(500, 5);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.ratio).toBeNull();
    unsub();
  });

  it('alerts once per episode and re-arms after recovery', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    feed(100, 100);
    feed(900, 2); // a brief spike, too short to move the baseline's tail
    expect(alerts).toHaveLength(1);

    feed(100, 10); // recovered — the alert clears
    feed(900, 2); // and spikes again
    expect(alerts).toHaveLength(2);
    unsub();
  });

  it('stops alerting once slowness has become the norm', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    feed(100, 35);
    feed(900, 60); // sustained, long enough to dominate the history

    // Only the transition is reported. Once the slow period fills the
    // baseline, "slower than usual" is no longer true — it *is* usual. That
    // is honest rather than a missed alert: a detector comparing a model
    // against its own history cannot also tell you the history is bad. A
    // fixed service-level target would be the tool for that, and this
    // platform deliberately holds none.
    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('ignores impossible latencies rather than recording them', () => {
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    recordLatencyObservation({ ...model, latencyMs: -1 });
    recordLatencyObservation({ ...model, latencyMs: Number.NaN });

    // A negative or non-finite duration is a broken measurement, and
    // admitting it into the baseline would corrupt every later comparison.
    expect(getLatencyDriftReport()).toHaveLength(0);
  });

  it('tracks each model separately', () => {
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    feed(100, 40);
    for (let i = 0; i < 40; i++) {
      recordLatencyObservation({ providerId: 'openai', modelId: 'gpt-x', latencyMs: 3000 });
    }

    const report = getLatencyDriftReport();
    expect(report).toHaveLength(2);
    // A consistently slow model is not drifting; it is consistently slow.
    expect(report.every((r) => !r.drifting)).toBe(true);
  });

  it('picks up latency from real AI traffic end to end', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    const base = {
      promptId: 'chat.generate',
      providerId: 'anthropic',
      modelId: 'claude-live',
      success: true,
    };
    for (let i = 0; i < 35; i++) recordAiInteraction({ ...base, latencyMs: 100 });
    for (let i = 0; i < 5; i++) recordAiInteraction({ ...base, latencyMs: 800 });

    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('startLatencyDrift is idempotent', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.latency_drift', (e) => alerts.push(e));
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });
    startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });

    const base = { promptId: 'chat.generate', providerId: 'anthropic', modelId: 'claude-idem', success: true };
    for (let i = 0; i < 35; i++) recordAiInteraction({ ...base, latencyMs: 100 });
    for (let i = 0; i < 5; i++) recordAiInteraction({ ...base, latencyMs: 800 });

    expect(alerts).toHaveLength(1);
    unsub();
  });

  describe('as a proposal', () => {
    it('becomes a proposal through the engine', () => {
      startLatencyDrift({ windowSize: 5, minBaselineSamples: 30 });
      startProposalEngine();

      feed(100, 35);
      feed(600, 5);

      const proposals = listProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].trigger).toBe('latency-drift');
    });

    it('says the cause is frequently not ours', () => {
      const proposal = buildLatencyDriftProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineP95Ms: 100,
        recentP95Ms: 400,
        ratio: 4,
        baselineSamples: 60,
        windowSize: 20,
      });

      // Implying our code is at fault would send a reader looking in the
      // wrong place first.
      expect(proposal.caveats.some((c) => /outside our code/i.test(c))).toBe(true);
      expect(proposal.suggestedAction).toMatch(/provider’s own status page first/i);
    });

    it('states that it describes the tail, not the typical experience', () => {
      const proposal = buildLatencyDriftProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineP95Ms: 100,
        recentP95Ms: 400,
        ratio: 4,
        baselineSamples: 60,
        windowSize: 20,
      });

      expect(proposal.caveats.some((c) => /slowest one call in twenty/i.test(c))).toBe(true);
      expect(proposal.problem).toContain('4.0×');
    });

    it('does not report an uncomputable ratio as a number', () => {
      const proposal = buildLatencyDriftProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineP95Ms: 0,
        recentP95Ms: 400,
        ratio: null,
        baselineSamples: 60,
        windowSize: 20,
      });

      expect(proposal.evidence.metrics.ratio).toBe('not computable (baseline was zero)');
      expect(proposal.caveats.some((c) => /no multiple to report/i.test(c))).toBe(true);
    });
  });
});
