import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { ApiException } from '@synora/shared';
import { getConfig } from '../config';
import { captureException } from '../monitoring/sentry';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error('Error occurred', {
    url: req.url,
    method: req.method,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Zod validation failures are client errors (bad request body/params),
  // never a 500. Surface the field-level issues so the caller can correct
  // the request, without leaking any server internals.
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: error.flatten(),
      },
    });
  }

  if (error instanceof ApiException) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  if (error instanceof Error) {
    // Only genuine 500s reach this branch — Zod and ApiException returns
    // above are expected client-facing outcomes, not defects. This is the
    // signal an error tracker exists for. No-op unless SENTRY_DSN is set.
    captureException(error, {
      url: req.url,
      method: req.method,
      correlationId: req.headers['x-correlation-id'],
    });

    const isDevelopment = getConfig().stage === 'development';
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isDevelopment ? error.message : 'Internal server error',
        details: isDevelopment ? { stack: error.stack } : undefined,
      },
    });
  }

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}
