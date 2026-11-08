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

// Every model's id is @default(cuid()) (see packages/database/prisma/schema.prisma),
// not a UUID -- validating these as .uuid() rejected every legitimate id.
const idSchema = z.object({
  workspaceId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
  folderId: z.string().cuid().optional(),
  assetId: z.string().cuid().optional(),
}).partial().passthrough();

export function validatePaginationQuery(_req: Request, _res: Response, next: NextFunction) {
  try {
    paginationSchema.parse(_req.query);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid pagination query parameters', {
        path: _req.path,
        error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return _res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid pagination parameters',
          details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message })),
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
        error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return _res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid date range parameters',
          details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message })),
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
        error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return _res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid ID parameters',
          details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message })),
        },
      });
    }
    next(error);
  }
}
