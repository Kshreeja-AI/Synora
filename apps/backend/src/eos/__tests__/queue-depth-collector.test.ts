import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollectAllMetrics, mockEmit } = vi.hoisted(() => ({
  mockCollectAllMetrics: vi.fn(),
  mockEmit: vi.fn(),
}));

vi.mock('../../queue/metrics', () => ({
  getMetricsCollector: () => ({
    collectAllMetrics: mockCollectAllMetrics,
  }),
}));

vi.mock('../event-bus', () => ({
  engineeringEventBus: { emit: mockEmit },
}));

import { sampleQueueDepths, startQueueDepthCollector, stopQueueDepthCollector } from '../queue-depth-collector';

describe('queue-depth-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopQueueDepthCollector();
  });

  it('emits queue.depth events for queues with pending work', async () => {
    mockCollectAllMetrics.mockResolvedValueOnce(
      new Map([
        ['generate_response', { waiting: 5, active: 2, delayed: 1, completed: 10, failed: 0, processed: 10, paused: 0, errors: [] }],
        ['cleanup', { waiting: 0, active: 0, delayed: 0, completed: 3, failed: 0, processed: 3, paused: 0, errors: [] }],
      ]),
    );

    await sampleQueueDepths();

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const event = mockEmit.mock.calls[0][0];
    expect(event.type).toBe('queue.depth');
    expect(event.source).toBe('queue-depth-collector');
    expect(event.payload).toEqual({
      queue: 'generate_response',
      waiting: 5,
      active: 2,
      delayed: 1,
      depth: 8,
    });
  });

  it('skips queues with zero depth', async () => {
    mockCollectAllMetrics.mockResolvedValueOnce(
      new Map([
        ['cleanup', { waiting: 0, active: 0, delayed: 0, completed: 5, failed: 0, processed: 5, paused: 0, errors: [] }],
      ]),
    );

    await sampleQueueDepths();

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emits events for multiple busy queues', async () => {
    mockCollectAllMetrics.mockResolvedValueOnce(
      new Map([
        ['generate_response', { waiting: 3, active: 1, delayed: 0, completed: 0, failed: 0, processed: 0, paused: 0, errors: [] }],
        ['process_file', { waiting: 0, active: 0, delayed: 2, completed: 0, failed: 0, processed: 0, paused: 0, errors: [] }],
      ]),
    );

    await sampleQueueDepths();

    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit.mock.calls[0][0].payload.queue).toBe('generate_response');
    expect(mockEmit.mock.calls[0][0].payload.depth).toBe(4);
    expect(mockEmit.mock.calls[1][0].payload.queue).toBe('process_file');
    expect(mockEmit.mock.calls[1][0].payload.depth).toBe(2);
  });

  it('startQueueDepthCollector is idempotent', () => {
    vi.useFakeTimers();
    try {
      startQueueDepthCollector(1000);
      startQueueDepthCollector(1000);
      stopQueueDepthCollector();
    } finally {
      vi.useRealTimers();
    }
  });
});
