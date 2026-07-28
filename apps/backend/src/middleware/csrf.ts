import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenException } from '@synora/shared';
import { logger } from '../utils/logger';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'X-CSRF-Token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Generates a cryptographically secure CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * CSRF protection middleware using double-submit cookie pattern.
 *
 * For GET/HEAD/OPTIONS: generates and sets CSRF token in cookie
 * For mutating requests (POST/PUT/PATCH/DELETE): validates token
 *
 * Token is stored in both:
 * - HttpOnly secure cookie (prevents XSS from reading it)
 * - Custom header (sent by frontend on mutations)
 *
 * This validates they match, preventing CSRF attacks while allowing
 * stateless operation (no server-side token storage needed).
 *
 * Note: CSRF protection is disabled in test environments to allow
 * test suites to run without token setup complexity.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Skip CSRF protection entirely in test environment
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const isMutatingRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isPublicEndpoint = req.path.startsWith('/api/shared') ||
                           req.path.startsWith('/api/billing/webhook') ||
                           req.path.startsWith('/api/auth');

  // Skip CSRF protection for public endpoints and webhook handlers
  // (webhooks are signed differently)
  if (isPublicEndpoint) {
    return next();
  }

  // For safe methods (GET, HEAD, OPTIONS), generate token if not present
  if (!isMutatingRequest) {
    const existingToken = req.cookies[CSRF_COOKIE_NAME];
    if (!existingToken) {
      const newToken = generateCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });
    }
    return next();
  }

  // For mutating requests, validate CSRF token
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()] as string | undefined;
  const bodyToken = (req.body as Record<string, unknown>)._csrf as string | undefined;

  // Accept token from header (preferred) or body
  const providedToken = headerToken || bodyToken;

  if (!cookieToken) {
    logger.warn('CSRF: missing cookie token', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    throw new ForbiddenException('CSRF token missing. Make a GET request first to obtain a token.');
  }

  if (!providedToken) {
    logger.warn('CSRF: missing provided token', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    throw new ForbiddenException('CSRF token not provided in request header or body.');
  }

  // Constant-time comparison to prevent timing attacks
  const cookieBuffer = Buffer.from(cookieToken);
  const providedBuffer = Buffer.from(providedToken);

  if (
    cookieBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(cookieBuffer, providedBuffer)
  ) {
    logger.warn('CSRF: token mismatch', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    throw new ForbiddenException('CSRF token validation failed.');
  }

  // Token is valid; regenerate for next request
  const newToken = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });

  next();
}
