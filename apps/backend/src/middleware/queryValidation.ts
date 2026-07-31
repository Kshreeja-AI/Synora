import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const paginationSchema = z.object({
  skip: z.coerce.number().min(0).max(100000).optional(),
  take: z.coerce.number().min(1).max(1000).optional(),
  search: z.string().max(500).optional(),
}).passthrough();

const dateRangeSchema = z.object({
  from: z.string().refine(v => !v || !isNaN(Date.parse(v)), 'Invalid date format').optional(),
  to: z.string().refine(v => !v || !isNaN(Date.parse(v)), 'Invalid date format').optional(),
  before: z.string().refine(v => !v || !isNaN(Date.parse(v)), 'Invalid date format').optional(),
  after: z.string().refine(v => !v || !isNaN(Date.parse(v)), 'Invalid date format').optional(),
}).passthrough();

const idSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
}).partial().passthrough();

export function validatePaginationQuery(_req: Request, _res: Response, next: NextFunction) {
  try {
    paginationSchema.parse(_req.query);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid pagination query parameters', {
        path: _req.path,
        error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return _res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid pagination parameters',
          details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        },
      });
    }
    next(error);
  }
}

export function validateDateRangeQuery(_req: Request, _res: Response, next: NextFunction) {
  try {
    dateRangeSchema.parse(_req.query);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid date range query parameters', {
        path: _req.path,
        error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return _res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid date range parameters',
          details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        },
      });
    }
    next(error);
  }
}

export function validateIdQuery(_req: Request, _res: Response, next: NextFunction) {
  try {
    idSchema.parse(_req.query);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid ID query parameters', {
        path: _req.path,
        error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return _res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid ID parameters',
          details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        },
      });
    }
    next(error);
  }
}
