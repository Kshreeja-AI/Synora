import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import { startErrorRateMonitor, stopErrorRateMonitor, getErrorRateSnapshot } from '../error-rate-monitor';

describe('error-rate-monitor', () => {
  beforeEach(() => {
    stopErrorRateMonitor();
  });

  function emitError(timestamp = Date.now()) {
    engineeringEventBus.emit({
      type: 'api.request.error',
      timestamp,
      source: 'test',
      payload: { method: 'GET', path: '/test', statusCode: 500, durationMs: 10 },
    });
  }

  it('does not emit alert below threshold', () => {
    startErrorRateMonitor({ threshold: 5, windowMs: 60_000 });

    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.error_rate', (e) => alerts.push(e));

    for (let i = 0; i < 4; i++) emitError();

    expect(alerts).toHaveLength(0);
    const snap = getErrorRateSnapshot();
    expect(snap.errorsInWindow).toBe(4);
    unsub();
  });

  it('emits alert when threshold reached', () => {
    startErrorRateMonitor({ threshold: 3, windowMs: 60_000 });

    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.error_rate', (e) => alerts.push(e));

    for (let i = 0; i < 3; i++) emitError();

    expect(alerts).toHaveLength(1);
    unsub();
  });

  it('resets window after alert fires', () => {
    startErrorRateMonitor({ threshold: 2, windowMs: 60_000 });

    const alerts: unknown[] = [];
    const unsub = engineeringEventBus.on('alert.error_rate', (e) => alerts.push(e));

    emitError();
    emitError();
    expect(alerts).toHaveLength(1);

    const snap = getErrorRateSnapshot();
    expect(snap.errorsInWindow).toBe(0);
    unsub();
  });

  it('prunes old errors outside window', () => {
    startErrorRateMonitor({ threshold: 5, windowMs: 1000 });

    const now = Date.now();
    emitError(now - 2000);
    emitError(now - 1500);

    const snap = getErrorRateSnapshot();
    expect(snap.errorsInWindow).toBe(0);
  });

  it('startErrorRateMonitor is idempotent', () => {
    startErrorRateMonitor({ threshold: 3 });
    startErrorRateMonitor({ threshold: 3 });
    stopErrorRateMonitor();
  });
});
