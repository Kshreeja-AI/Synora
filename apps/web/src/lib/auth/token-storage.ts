import type { AuthTokens } from '../api/types';

/**
 * Token storage using HttpOnly secure cookies.
 *
 * Tokens are stored in HttpOnly cookies set by the backend, which:
 * - Cannot be accessed by JavaScript (prevents XSS token theft)
 * - Are automatically sent with every request (credentials: 'include')
 * - Are cleared on logout via Set-Cookie headers
 *
 * This file is kept for API compatibility but no longer uses localStorage.
 * The backend sets cookies directly on login/register/refresh.
 */

export function getAccessToken(): string | null {
  // Tokens are in HttpOnly cookies, not accessible via JS
  // Return null to indicate tokens are cookie-based
  return null;
}

export function getRefreshToken(): string | null {
  // Tokens are in HttpOnly cookies, not accessible via JS
  return null;
}

export function setTokens(_tokens: AuthTokens): void {
  // Backend sets HttpOnly cookies directly on auth endpoints
  // No client-side storage needed
}

export function clearTokens(): void {
  // Backend clears cookies on logout
  // No client-side cleanup needed
}
