import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../event-bus', () => ({
  engineeringEventBus: { emit: vi.fn() },
}));

import {
  registerHealthProbe,
  runHealthProbes,
  startHealthCollector,
  stopHealthCollector,
} from '../health-collector';
import { engineeringEventBus } from '../event-bus';

describe('health-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopHealthCollector();
  });

  it('does not emit events for healthy probes', async () => {
    registerHealthProbe({
      name: 'test-healthy',
      check: async () => 'healthy',
    });

    await runHealthProbes();

    const calls = (engineeringEventBus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const testCalls = calls.filter(
      ([e]: any) => e.payload?.service === 'test-healthy'
    );
    expect(testCalls).toHaveLength(0);
  });

  it('emits event for degraded probes', async () => {
    registerHealthProbe({
      name: 'test-degraded',
      check: async () => 'degraded',
    });

    await runHealthProbes();

    expect(engineeringEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'health.check',
        payload: expect.objectContaining({
          service: 'test-degraded',
          status: 'degraded',
        }),
      })
    );
  });

  it('emits down for probes that throw', async () => {
    registerHealthProbe({
      name: 'test-throws',
      check: async () => {
        throw new Error('connection refused');
      },
    });

    await runHealthProbes();

    expect(engineeringEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'health.check',
        payload: expect.objectContaining({
          service: 'test-throws',
          status: 'down',
        }),
      })
    );
  });

  it('starts and stops interval-based collection', () => {
    vi.useFakeTimers();

    startHealthCollector(1000);
    startHealthCollector(1000);

    vi.advanceTimersByTime(1000);

    stopHealthCollector();
    vi.useRealTimers();
  });
});
