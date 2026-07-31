import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

interface RequestWithTimeout extends Request {
  timeoutHandle?: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 30000;
const _STREAMING_TIMEOUT_MS = 5 * 60000;
const WEBHOOK_TIMEOUT_MS = 10000;

const routeTimeouts: Record<string, number> = {
  '/api/ai': DEFAULT_TIMEOUT_MS,
  '/api/billing/webhook': WEBHOOK_TIMEOUT_MS,
  '/api/conversations': DEFAULT_TIMEOUT_MS,
  '/health': 5000,
  '/ready': 10000,
};

export function requestTimeout(req: RequestWithTimeout, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const path = req.path;
  const timeoutMs = routeTimeouts[path] || DEFAULT_TIMEOUT_MS;

  const handleTimeout = () => {
    if (!res.headersSent) {
      logger.warn('Request timeout', {
        path: req.path,
        method: req.method,
        timeoutMs,
      });

      res.status(408).json({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Request processing timeout. Please try again.',
        },
      });
    }
  };

  req.timeoutHandle = setTimeout(handleTimeout, timeoutMs);

  res.on('finish', () => {
    if (req.timeoutHandle) {
      clearTimeout(req.timeoutHandle);
    }
  });

  res.on('close', () => {
    if (req.timeoutHandle) {
      clearTimeout(req.timeoutHandle);
    }
  });

  next();
}
