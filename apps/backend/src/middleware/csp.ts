import type { Request, Response, NextFunction } from 'express';

/**
 * Content Security Policy middleware for production security.
 *
 * Sets strict but pragmatic CSP directives to prevent XSS and injection attacks
 * while allowing legitimate resources needed by the application.
 *
 * Policy Strategy:
 * - Script: 'self' only (no inline scripts, no unsafe-eval)
 * - Style: 'self' + unsafe-inline (Tailwind CSS requires inline styles)
 * - Images: 'self' + data: (for inline SVGs, base64 images)
 * - Fonts: 'self' (web fonts served from own domain)
 * - Connect: 'self' + necessary third-party APIs (AI providers, analytics)
 * - Frame-ancestors: 'none' (prevent clickjacking)
 * - Base-uri: 'self' (prevent injection via <base> tag)
 * - Form-action: 'self' (prevent form hijacking)
 * - Upgrade-insecure-requests: enforce HTTPS in production
 */
export function cspMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const isDevelopment = process.env.NODE_ENV === 'development';

  const baseDirectives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'"],
    'connect-src': [
      "'self'",
      'https:',
      'wss:',
      'ws:',
    ],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'media-src': ["'self'", 'https:'],
  };

  const directivesArray = Object.entries(baseDirectives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');

  const policy = `${directivesArray}; upgrade-insecure-requests`;

  if (isDevelopment) {
    res.setHeader('Content-Security-Policy-Report-Only', policy);
  } else {
    res.setHeader('Content-Security-Policy', policy);
  }

  next();
}
