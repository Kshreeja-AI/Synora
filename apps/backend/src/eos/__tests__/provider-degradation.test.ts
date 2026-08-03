import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  recordReliabilityObservation,
  getDegradationReport,
  startProviderDegradation,
  stopProviderDegradation,
} from '../provider-degradation';
import { recordAiInteraction } from '../instrumentation';
import {
  buildProviderDegradationProposal,
  startProposalEngine,
  stopProposalEngine,
  listProposals,
} from '../proposal-engine';

const model = { providerId: 'anthropic', modelId: 'claude-x' };

function feed(success: boolean, n: number, errorCode?: string) {
  for (let i = 0; i < n; i++) recordReliabilityObservation({ ...model, success, errorCode });
}

describe('provider-degradation', () => {
  beforeEach(() => {
    stopProviderDegradation();
    stopProposalEngine();
  });

  it('says nothing until it has enough history', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) => alerts.push(e));
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });

    feed(true, 5);
    feed(false, 5);

    expect(alerts).toHaveLength(0);
    const [entry] = getDegradationReport();
    expect(entry.sufficientData).toBe(false);
    // Null, not zero: no baseline was ever established.
    expect(entry.baselineSuccessRate).toBeNull();
    expect(entry.dropPercentagePoints).toBeNull();
    unsub();
  });

  it('measures in percentage points, so a small-sounding drop still alerts', () => {
    const alerts: Array<{ payload: Record<string, unknown> }> = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) =>
      alerts.push(e as { payload: Record<string, unknown> }),
    );
    startProviderDegradation({ windowSize: 20, minBaselineSamples: 50, dropPointsThreshold: 10 });

    feed(true, 60);
    // 100% → 85%. As a ratio that is 0.85 — a rounding error by the
    // measure its sibling detectors use, and three failures in twenty
    // where there used to be none.
    feed(false, 3);
    feed(true, 17);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.dropPercentagePoints).toBe(15);
    unsub();
  });

  it('does not alert on a drop below the threshold', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) => alerts.push(e));
    startProviderDegradation({ windowSize: 20, minBaselineSamples: 50, dropPointsThreshold: 10 });

    feed(true, 60);
    feed(false, 1); // 5 points — real, within ordinary variation
    feed(true, 19);

    expect(alerts).toHaveLength(0);
    unsub();
  });

  it('never alerts on getting more reliable', () => {
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });

    // Establish a middling baseline first. Subscribing only afterwards is
    // deliberate: an unreliable baseline naturally dips below itself while
    // it forms, and those dips are real detections, not the property under
    // test here.
    for (let i = 0; i < 40; i++) recordReliabilityObservation({ ...model, success: i % 2 === 0 });

    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) => alerts.push(e));

    feed(true, 20);

    expect(alerts).toHaveLength(0);
    unsub();
  });

  it('carries the error codes, so a rate limit is distinguishable from a timeout', () => {
    const alerts: Array<{ payload: Record<string, unknown> }> = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) =>
      alerts.push(e as { payload: Record<string, unknown> }),
    );
    // A threshold of 60 points needs three failures in a five-request
    // window, so all three codes are on record when the alert fires. It
    // fires at the crossing point, so it reports the codes seen by then —
    // not every code that will eventually appear.
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30, dropPointsThreshold: 60 });

    feed(true, 35);
    recordReliabilityObservation({ ...model, success: false, errorCode: 'rate_limited' });
    recordReliabilityObservation({ ...model, success: false, errorCode: 'rate_limited' });
    recordReliabilityObservation({ ...model, success: false, errorCode: 'timeout' });

    expect(alerts).toHaveLength(1);
    // Deduplicated: two rate limits are one kind of problem.
    expect(alerts[0].payload.errorCodes).toEqual(['rate_limited', 'timeout']);
    unsub();
  });

  it('alerts once per episode and re-arms after recovery', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) => alerts.push(e));
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });

    feed(true, 100);
    feed(false, 2);
    expect(alerts).toHaveLength(1);

    feed(true, 10); // recovered
    feed(false, 2); // and fails again
    expect(alerts).toHaveLength(2);
    unsub();
  });

  it('tracks each model separately', () => {
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });

    feed(true, 40);
    for (let i = 0; i < 40; i++) {
      recordReliabilityObservation({ providerId: 'openai', modelId: 'gpt-x', success: false });
    }

    const report = getDegradationReport();
    expect(report).toHaveLength(2);
    // A model that has always failed is not degrading; it is broken, and
    // that is a different statement this detector deliberately cannot make.
    expect(report.every((r) => !r.degraded)).toBe(true);
  });

  it('picks up reliability from real AI traffic end to end', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) => alerts.push(e));
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });

    const base = {
      promptId: 'chat.generate',
      providerId: 'anthropic',
      modelId: 'claude-live',
      latencyMs: 100,
    };
    for (let i = 0; i < 35; i++) recordAiInteraction({ ...base, success: true });
    for (let i = 0; i < 3; i++) recordAiInteraction({ ...base, success: false, errorCode: 'timeout' });

    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('startProviderDegradation is idempotent', () => {
    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.provider_degradation', (e) => alerts.push(e));
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });
    startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });

    const base = { promptId: 'chat.generate', providerId: 'anthropic', modelId: 'claude-idem', latencyMs: 1 };
    for (let i = 0; i < 35; i++) recordAiInteraction({ ...base, success: true });
    for (let i = 0; i < 3; i++) recordAiInteraction({ ...base, success: false });

    expect(alerts).toHaveLength(1);
    unsub();
  });

  describe('as a proposal', () => {
    it('becomes a proposal through the engine', () => {
      startProviderDegradation({ windowSize: 5, minBaselineSamples: 30 });
      startProposalEngine();

      feed(true, 35);
      feed(false, 3, 'timeout');

      const proposals = listProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].trigger).toBe('provider-degradation');
    });

    it('says a failure may be our fault, not the provider’s', () => {
      const proposal = buildProviderDegradationProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineSuccessRate: 1,
        recentSuccessRate: 0.8,
        dropPercentagePoints: 20,
        baselineSamples: 60,
        windowSize: 20,
        errorCodes: ['timeout'],
      });

      // A malformed request we sent counts as a failure exactly like an
      // outage does. Implying the provider is at fault would misdirect.
      expect(proposal.caveats.some((c) => /could not accept/i.test(c))).toBe(true);
      expect(proposal.caveats.some((c) => /Retries may already be hiding this/i.test(c))).toBe(true);
    });

    it('leads with the error codes when it has them', () => {
      const proposal = buildProviderDegradationProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineSuccessRate: 1,
        recentSuccessRate: 0.8,
        dropPercentagePoints: 20,
        baselineSamples: 60,
        windowSize: 20,
        errorCodes: ['rate_limited', 'timeout'],
      });

      expect(proposal.suggestedAction).toMatch(/Read the error codes first \(rate_limited, timeout\)/);
      expect(proposal.evidence.metrics.errorCodes).toBe('rate_limited, timeout');
    });

    it('says plainly when no error codes were recorded', () => {
      const proposal = buildProviderDegradationProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineSuccessRate: 1,
        recentSuccessRate: 0.8,
        dropPercentagePoints: 20,
        baselineSamples: 60,
        windowSize: 20,
      });

      expect(proposal.evidence.metrics.errorCodes).toBe('none recorded');
      expect(proposal.caveats.some((c) => /kind of failure is unknown/i.test(c))).toBe(true);
    });

    it('states the drop in points, not as a ratio', () => {
      const proposal = buildProviderDegradationProposal({
        providerId: 'anthropic',
        modelId: 'claude-x',
        baselineSuccessRate: 1,
        recentSuccessRate: 0.85,
        dropPercentagePoints: 15,
        baselineSamples: 60,
        windowSize: 20,
      });

      expect(proposal.problem).toContain('15 percentage points');
      expect(proposal.evidence.metrics.dropPercentagePoints).toBe(15);
    });
  });
});
