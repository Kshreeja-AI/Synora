import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiException } from '@synora/shared';
import { getConfig } from '../config';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Error occurred', {
    url: req.url,
    method: req.method,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

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
