import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// Request-scoped context for correlation IDs
export const correlationContext = new AsyncLocalStorage<{
  correlationId: string;
  requestId: string;
  traceId: string;
}>();

export interface RequestWithContext extends Request {
  correlationId: string;
  requestId: string;
  traceId: string;
}

export function correlationIdMiddleware(req: RequestWithContext, res: Response, next: NextFunction): void {
  // Use provided IDs or generate new ones
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();

  // Attach to request
  req.correlationId = correlationId;
  req.requestId = requestId;
  req.traceId = traceId;

  // Propagate headers to response
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);

  // Store in async local storage for access in services
  correlationContext.run({ correlationId, requestId, traceId }, () => {
    next();
  });
}

// Utility to get current context
export function getCorrelationContext() {
  return correlationContext.getStore();
}
