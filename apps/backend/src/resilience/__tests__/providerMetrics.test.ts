/**
 * Provider call metrics — specifically, the distinction between a call that
 * FAILED and a call Synora REFUSED TO SEND.
 *
 * Every test here is a way an operator could be misled on the day something
 * goes wrong. A collector that blurs refusals into failures sends someone
 * hunting a provider outage that never happened.
 */

import { describe, it, expect } from 'vitest';
import { ProviderMetricsCollector } from '../providerMetrics';

describe('ProviderMetricsCollector', () => {
  it('counts a refusal as an attempt but never as a sent call', () => {
    const metrics = new ProviderMetricsCollector();
    metrics.record({ providerId: 'anthropic', outcome: 'refused-rate-limit' });

    const m = metrics.get('anthropic');
    expect(m.attempts).toBe(1);
    // Nothing reached the provider, so nothing was billed and nothing failed.
    expect(m.sent).toBe(0);
    expect(m.failed).toBe(0);
    expect(m.refusedRateLimit).toBe(1);
  });

  it('keeps the two refusal reasons apart', () => {
    // Our own pacing and a provider we have stopped calling are different
    // situations with different fixes.
    const metrics = new ProviderMetricsCollector();
    metrics.record({ providerId: 'openai', outcome: 'refused-rate-limit' });
    metrics.record({ providerId: 'openai', outcome: 'refused-circuit-open' });

    const m = metrics.get('openai');
    expect(m.refusedRateLimit).toBe(1);
    expect(m.refusedCircuitOpen).toBe(1);
  });

  it('computes error rate over calls actually sent, not over all attempts', () => {
    const metrics = new ProviderMetricsCollector();
    metrics.record({ providerId: 'p', outcome: 'success', latencyMs: 100 });
    metrics.record({ providerId: 'p', outcome: 'failure', latencyMs: 200 });
    // Eight refusals that never touched the provider.
    for (let i = 0; i < 8; i++) {
      metrics.record({ providerId: 'p', outcome: 'refused-rate-limit' });
    }

    const m = metrics.get('p');
    expect(m.attempts).toBe(10);
    expect(m.sent).toBe(2);
    // 1 of 2 sent = 50%. Averaging refusals in would report 10% and
    // understate how badly the provider is actually doing.
    expect(m.errorRateOfSent).toBe(0.5);
  });

  it('averages latency over sent calls only', () => {
    const metrics = new ProviderMetricsCollector();
    metrics.record({ providerId: 'p', outcome: 'success', latencyMs: 100 });
    metrics.record({ providerId: 'p', outcome: 'failure', latencyMs: 300 });
    metrics.record({ providerId: 'p', outcome: 'refused-circuit-open' });

    // A refusal takes no time; counting it would drag the average toward
    // zero and make a slow provider look fast.
    expect(metrics.get('p').avgLatencyMs).toBe(200);
  });

  it('accumulates token usage only from calls that returned it', () => {
    const metrics = new ProviderMetricsCollector();
    metrics.record({
      providerId: 'p',
      outcome: 'success',
      latencyMs: 10,
      inputTokens: 100,
      outputTokens: 50,
    });
    // A provider that reports no usage must not be counted as zero-cost
    // beyond what it actually told us — it simply adds nothing.
    metrics.record({ providerId: 'p', outcome: 'success', latencyMs: 10 });

    const m = metrics.get('p');
    expect(m.totalInputTokens).toBe(100);
    expect(m.totalOutputTokens).toBe(50);
    expect(m.succeeded).toBe(2);
  });

  it('keeps providers separate and reports an unseen provider as all zeros', () => {
    const metrics = new ProviderMetricsCollector();
    metrics.record({ providerId: 'anthropic', outcome: 'success', latencyMs: 10 });

    expect(metrics.get('openai').attempts).toBe(0);
    expect(Object.keys(metrics.snapshot())).toEqual(['anthropic']);
  });
});
