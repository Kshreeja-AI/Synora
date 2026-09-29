import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../event-bus', () => ({
  engineeringEventBus: { emit: vi.fn() },
}));

import { markBootStart, emitBootComplete } from '../boot-collector';
import { engineeringEventBus } from '../event-bus';

describe('boot-collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits server.boot event with duration', () => {
    markBootStart();
    emitBootComplete();

    expect(engineeringEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'server.boot',
        source: 'boot-collector',
        payload: expect.objectContaining({
          durationMs: expect.any(Number),
          nodeVersion: expect.stringMatching(/^v/),
          pid: expect.any(Number),
          memoryMb: expect.any(Number),
        }),
      })
    );
  });

  it('reports 0ms duration when markBootStart was not called', () => {
    emitBootComplete();

    const call = (engineeringEventBus.emit as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.payload.durationMs).toBe(0);
  });
});
