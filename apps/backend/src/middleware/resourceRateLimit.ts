import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { AuthRequest } from './auth.js';
import { logger } from '../utils/logger.js';

/**
 * Rate limits for endpoints that cost real money or real compute per call:
 * provider inference, media generation, embedding-backed search, dataset
 * exports and evaluation runs.
 *
 * These are deliberately separate from `authRateLimit.ts` (which protects
 * credential endpoints from brute force) and from the global limiter in
 * `app.ts` (a coarse per-IP ceiling on all traffic).
 *
 * Keyed by authenticated user, not by IP. The global limiter is per-IP, which
 * is the wrong unit for authenticated spend: everyone behind one corporate NAT
 * or mobile carrier gateway shares a single budget, while one account driving
 * requests from several addresses is never actually capped. Unauthenticated
 * callers still fall back to IP so the limiter cannot be bypassed by simply
 * omitting credentials.
 */

/** Requests that reached a limiter without auth are bucketed per-IP. */
function keyByUserOrIp(req: Request): string {
  const userId = (req as AuthRequest).userId;
  if (userId) return `user:${userId}`;
  // express-rate-limit's default key is the IP; mirror it for anonymous callers.
  return `ip:${req.ip ?? 'unknown'}`;
}

export interface ResourceLimiterOptions {
  /** Short identifier used in logs, e.g. 'ai-generation'. */
  name: string;
  windowMs: number;
  max: number;
  /** Shown to the caller on 429. Should say what to do, not just what failed. */
  message: string;
}

/**
 * Build a limiter that shares the response envelope and logging conventions of
 * the rest of the codebase, so a 429 from here is indistinguishable in shape
 * from a 429 raised by the auth limiters.
 */
export function createResourceLimiter(options: ResourceLimiterOptions): RateLimitRequestHandler {
  const config: Partial<Options> = {
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    // The suite drives these endpoints far above production rates on purpose;
    // matches the existing convention in authRateLimit.ts.
    skip: () => process.env.NODE_ENV === 'test',
    handler: (req: Request, res: Response) => {
      logger.warn('Resource rate limit exceeded', {
        limiter: options.name,
        userId: (req as AuthRequest).userId,
        ip: req.ip,
        path: req.originalUrl,
      });
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message,
        },
      });
    },
  };

  return rateLimit(config);
}

/**
 * Text/chat inference. Generous enough for a fast human conversation
 * (and for a UI that retries), tight enough that a runaway client or a stolen
 * session cannot bill an unbounded number of provider calls.
 */
export const aiGenerationLimiter = createResourceLimiter({
  name: 'ai-generation',
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many AI generation requests. Please wait a moment and try again.',
});

/**
 * Image/video/audio generation. An order of magnitude more expensive per call
 * than text, and asynchronous, so the ceiling is much lower.
 */
export const mediaGenerationLimiter = createResourceLimiter({
  name: 'media-generation',
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many media generation requests. Please wait a moment and try again.',
});

/**
 * Search. Cheap when it falls back to Postgres full-text, expensive when it
 * embeds the query against a provider first.
 */
export const searchLimiter = createResourceLimiter({
  name: 'search',
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many search requests. Please wait a moment and try again.',
});

/**
 * Bulk data movement: dataset exports and conversation export/import. Each one
 * can stream a large amount of data and occupy a worker.
 */
export const exportLimiter = createResourceLimiter({
  name: 'export',
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: 'Too many export requests. Please wait a few minutes and try again.',
});

/**
 * Evaluation runs — the most expensive operation in the product, since one run
 * fans out into many provider calls.
 */
export const evaluationLimiter = createResourceLimiter({
  name: 'evaluation',
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many evaluation runs. Please wait a few minutes and try again.',
});
