import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenException } from '@synora/shared';
import { logger } from '../utils/logger';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'X-CSRF-Token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const TEST_CSRF_TOKEN = 'test-csrf-token-for-testing-only-do-not-use-in-production';

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
 * - A cookie the PAGE'S OWN JAVASCRIPT CAN READ (see below)
 * - A custom header the frontend echoes back on mutations
 *
 * WHY THIS COOKIE IS NOT HttpOnly, deliberately. Double-submit works by
 * asking the caller to prove it can READ a cookie for this origin. Only
 * same-origin script can; a cross-site attacker can force the browser to
 * SEND cookies but can never read them back to copy into a header. That
 * asymmetry is the entire mechanism.
 *
 * Marking this cookie HttpOnly therefore does not harden it -- it disables
 * it. The legitimate page loses the same access the attacker never had, so
 * it can never produce the header, and every mutating request from the real
 * UI fails 403. That was the live state before this change: a user could
 * register and log in (those routes are exempt) and then do nothing at all.
 *
 * This token is not a credential. It authorises nothing and identifies
 * nobody; handing it to the page that already holds the session grants an
 * attacker nothing. The SESSION cookie stays HttpOnly, and this one keeps
 * `secure` and `sameSite: strict`.
 *
 * This validates they match, preventing CSRF attacks while allowing
 * stateless operation (no server-side token storage needed).
 *
 * In test environments, a special test CSRF token is recognized to allow
 * tests to opt-in to CSRF bypass without affecting production security.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Check if this is a test request using special test token
  const isTestRequest = process.env.NODE_ENV === 'test' &&
    (req.headers[CSRF_HEADER_NAME.toLowerCase()] === TEST_CSRF_TOKEN ||
     (req.body as Record<string, unknown>)?._csrf === TEST_CSRF_TOKEN);
  if (isTestRequest) {
    return next();
  }

  const isMutatingRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isPublicEndpoint = req.path.startsWith('/api/shared') ||
                           req.path.startsWith('/api/billing/webhook') ||
                           req.path.startsWith('/api/hooks') ||
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
        httpOnly: false, // readable by same-origin script on purpose -- see note above
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
    return next(new ForbiddenException('CSRF token missing. Make a GET request first to obtain a token.'));
  }

  if (!providedToken) {
    logger.warn('CSRF: missing provided token', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    return next(new ForbiddenException('CSRF token not provided in request header or body.'));
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
    return next(new ForbiddenException('CSRF token validation failed.'));
  }

  // Token is valid; regenerate for next request
  const newToken = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, newToken, {
    httpOnly: false, // readable by same-origin script on purpose -- see note above
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });

  next();
}

/**
 * Test helper: CSRF token that bypasses protection in test environment only.
 * Use in test requests by setting the X-CSRF-Token header or _csrf body field.
 */
export { TEST_CSRF_TOKEN };
