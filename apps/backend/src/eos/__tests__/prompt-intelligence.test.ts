import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  recordPromptOutcome,
  getPromptReport,
  startPromptIntelligence,
  stopPromptIntelligence,
} from '../prompt-intelligence';

describe('prompt-intelligence', () => {
  beforeEach(() => {
    stopPromptIntelligence();
  });

  it('returns empty report when nothing recorded', () => {
    expect(getPromptReport()).toEqual([]);
  });

  it('aggregates outcomes per prompt and version', () => {
    recordPromptOutcome({ promptId: 'summarize', version: 1, success: true, latencyMs: 100, inputTokens: 200, outputTokens: 50, costCents: 2 });
    recordPromptOutcome({ promptId: 'summarize', version: 1, success: false, latencyMs: 300, inputTokens: 400, outputTokens: 0, costCents: 1 });
    recordPromptOutcome({ promptId: 'summarize', version: 2, success: true, latencyMs: 80 });

    const report = getPromptReport();
    expect(report).toHaveLength(2);

    const v1 = report.find((r) => r.promptId === 'summarize' && r.version === 1)!;
    expect(v1.executions).toBe(2);
    expect(v1.successes).toBe(1);
    expect(v1.failures).toBe(1);
    expect(v1.successRate).toBe(0.5);
    expect(v1.avgInputTokens).toBe(300);
    expect(v1.totalCostCents).toBe(3);
    expect(v1.p50LatencyMs).toBe(100);

    const v2 = report.find((r) => r.version === 2)!;
    expect(v2.executions).toBe(1);
    expect(v2.successRate).toBe(1);
  });

  it('subscribes to ai.prompt.outcome events when started', () => {
    startPromptIntelligence();
    engineeringEventBus.emit({
      type: 'ai.prompt.outcome',
      timestamp: Date.now(),
      source: 'test',
      payload: { promptId: 'chat', success: true, latencyMs: 50 },
    });

    const report = getPromptReport();
    expect(report).toHaveLength(1);
    expect(report[0].promptId).toBe('chat');
    expect(report[0].executions).toBe(1);
  });

  it('emits alert.prompt_regression when recent window drops below baseline', () => {
    startPromptIntelligence({ windowSize: 5, dropThreshold: 0.3 });

    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.prompt_regression', (e) => alerts.push(e));

    // Build a strong baseline: 20 successes.
    for (let i = 0; i < 20; i++) {
      recordPromptOutcome({ promptId: 'plan', success: true, latencyMs: 10 });
    }
    expect(alerts).toHaveLength(0);

    // Recent window collapses: 5 straight failures.
    for (let i = 0; i < 5; i++) {
      recordPromptOutcome({ promptId: 'plan', success: false, latencyMs: 10 });
    }

    expect(alerts).toHaveLength(1);
    const alert = alerts[0] as any;
    expect(alert.payload.promptId).toBe('plan');
    expect(alert.payload.windowSize).toBe(5);
    // Alert fires the moment the window rate drops more than dropThreshold below baseline.
    expect(alert.payload.recentSuccessRate).toBeLessThan(alert.payload.overallSuccessRate - 0.3);

    const report = getPromptReport();
    expect(report[0].regressing).toBe(true);
    unsub();
  });

  it('does not re-alert while regression persists, re-alerts after recovery', () => {
    startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });

    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.prompt_regression', (e) => alerts.push(e));

    for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'code', success: true, latencyMs: 10 });
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'code', success: false, latencyMs: 10 });
    expect(alerts).toHaveLength(1);

    // Still failing — no duplicate alert.
    recordPromptOutcome({ promptId: 'code', success: false, latencyMs: 10 });
    expect(alerts).toHaveLength(1);

    // Recovery: window fills with successes again.
    for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'code', success: true, latencyMs: 10 });
    const report = getPromptReport();
    expect(report[0].regressing).toBe(false);
    unsub();
  });

  it('startPromptIntelligence is idempotent', () => {
    startPromptIntelligence();
    startPromptIntelligence();
    engineeringEventBus.emit({
      type: 'ai.prompt.outcome',
      timestamp: Date.now(),
      source: 'test',
      payload: { promptId: 'once', success: true, latencyMs: 5 },
    });
    const report = getPromptReport();
    expect(report[0].executions).toBe(1);
  });
});
