import type { Response } from 'express';

/**
 * Shared HTTP-layer helpers for establishing an authenticated session.
 *
 * These live outside `routes/auth.ts` because more than one route completes a
 * login: the password flow finishes in `POST /auth/login`, while an
 * MFA-protected account finishes in `POST /auth/mfa/verify` once the second
 * factor checks out. Both must set identical cookies and return an identical
 * payload shape — keeping one implementation here is what guarantees that,
 * rather than two copies drifting apart.
 */

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export function toAuthedUser(user: {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
}): AuthedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified !== null,
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  });
  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

/**
 * Tokens are delivered exclusively through the HttpOnly cookies set above, so
 * they are deliberately absent from the response body — the argument is kept
 * for call-site symmetry with `setAuthCookies`.
 */
export function authPayload(
  _tokens: { accessToken: string; refreshToken: string },
  user?: AuthedUser
): Record<string, unknown> {
  return {
    ...(user ? { user } : {}),
  };
}

/** Best-effort request metadata for the session/device list — never required for a request to succeed. */
export function deviceMetadata(req: { headers: { 'user-agent'?: string }; ip?: string }) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}
