import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'node:events';

vi.mock('../event-bus', () => {
  const emit = vi.fn();
  return {
    engineeringEventBus: {
      emit,
    },
  };
});

import { eosApiCollector } from '../api-collector';
import { engineeringEventBus } from '../event-bus';

function mockReqRes(overrides: {
  method?: string;
  path?: string;
  statusCode?: number;
} = {}) {
  const req = { method: overrides.method ?? 'GET', path: overrides.path ?? '/api/test' } as Request;
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: overrides.statusCode ?? 200,
    statusMessage: 'OK',
  }) as unknown as Response;
  return { req, res };
}

describe('eosApiCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not emit for normal fast requests', () => {
    const { req, res } = mockReqRes();
    const next: NextFunction = vi.fn();

    eosApiCollector(req, res, next);
    expect(next).toHaveBeenCalled();

    res.emit('finish');

    expect(engineeringEventBus.emit).not.toHaveBeenCalled();
  });

  it('emits api.request.error for 5xx responses', () => {
    const { req, res } = mockReqRes({ statusCode: 500, method: 'POST', path: '/api/messages' });
    (res as any).statusMessage = 'Internal Server Error';
    const next: NextFunction = vi.fn();

    eosApiCollector(req, res, next);
    res.emit('finish');

    expect(engineeringEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'api.request.error',
        source: 'api-collector',
        payload: expect.objectContaining({
          method: 'POST',
          path: '/api/messages',
          statusCode: 500,
          error: 'Internal Server Error',
        }),
      })
    );
  });

  it('does not emit for 4xx responses', () => {
    const { req, res } = mockReqRes({ statusCode: 404 });
    const next: NextFunction = vi.fn();

    eosApiCollector(req, res, next);
    res.emit('finish');

    expect(engineeringEventBus.emit).not.toHaveBeenCalled();
  });
});
