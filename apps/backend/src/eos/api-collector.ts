import type { Request, Response, NextFunction } from 'express';
import { engineeringEventBus } from './event-bus.js';
import { recordLatency } from './latency-tracker.js';

const SLOW_THRESHOLD_MS = parseInt(process.env.EOS_SLOW_REQUEST_MS || '2000', 10);

export function eosApiCollector(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;

    recordLatency(durationMs);

    if (durationMs >= SLOW_THRESHOLD_MS) {
      engineeringEventBus.emit({
        type: 'api.request.slow',
        timestamp: Date.now(),
        source: 'api-collector',
        payload: {
          method: req.method,
          path: req.route?.path ?? req.path,
          statusCode,
          durationMs,
        },
      });
    }

    if (statusCode >= 500) {
      engineeringEventBus.emit({
        type: 'api.request.error',
        timestamp: Date.now(),
        source: 'api-collector',
        payload: {
          method: req.method,
          path: req.route?.path ?? req.path,
          statusCode,
          durationMs,
          error: res.statusMessage,
        },
      });
    }
  });

  next();
}
