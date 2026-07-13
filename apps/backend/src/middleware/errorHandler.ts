import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiException } from '@synora/shared';

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
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? { stack: error.stack } : undefined,
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
