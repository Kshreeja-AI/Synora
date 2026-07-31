import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RequestWithContext extends Request {
  correlationId?: string;
  requestId?: string;
  traceId?: string;
}

export function requestLogger(req: RequestWithContext, res: Response, next: NextFunction) {
  const start = Date.now();
  const originalSend = res.send;

  res.send = function (data) {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    logger.info(`${req.method} ${req.url}`, {
      correlationId: req.correlationId,
      requestId: req.requestId,
      traceId: req.traceId,
      statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    return originalSend.call(this, data);
  };

  next();
}
