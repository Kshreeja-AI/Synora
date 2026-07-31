import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const paginationSchema = z.object({
  skip: z.coerce.number().min(0).max(100000).optional(),
  take: z.coerce.number().min(1).max(1000).optional(),
  search: z.string().max(500).optional(),
}).strict();

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
}).strict();

const idSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
}).partial().strict();

export function validatePaginationQuery(req: Request, _res: Response, next: NextFunction) {
  try {
    const validated = paginationSchema.parse(req.query);
    req.query = validated as any;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid pagination query parameters', {
        path: req.path,
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

export function validateDateRangeQuery(req: Request, _res: Response, next: NextFunction) {
  try {
    const validated = dateRangeSchema.parse(req.query);
    req.query = validated as any;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid date range query parameters', {
        path: req.path,
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

export function validateIdQuery(req: Request, _res: Response, next: NextFunction) {
  try {
    const validated = idSchema.parse(req.query);
    req.query = validated as any;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid ID query parameters', {
        path: req.path,
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
