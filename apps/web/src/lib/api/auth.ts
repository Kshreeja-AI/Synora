import { api } from './client';
import type { AuthResponse } from './types';
import { setTokens, clearTokens } from '../auth/token-storage';

/**
 * An MFA-enrolled account answers a correct password with a challenge instead
 * of a session; the login is completed by `verifyMfaChallenge` in lib/api/mfa.
 */
export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaChallengeToken: string;
  expiresAt: string;
}

export type LoginResult = AuthResponse | MfaChallengeResponse;

export function isMfaChallenge(result: LoginResult): result is MfaChallengeResponse {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as MfaChallengeResponse).mfaRequired === true
  );
}

export async function login(
  email: string,
  password: string,
  rememberMe?: boolean
): Promise<LoginResult> {
  const data = await api.post<LoginResult>(
    '/api/auth/login',
    { email, password, rememberMe },
    { anonymous: true }
  );
  if (!isMfaChallenge(data)) {
    setTokens(data);
  }
  return data;
}

export async function register(
  email: string,
  password: string,
  name?: string
): Promise<AuthResponse> {
  const data = await api.post<AuthResponse>(
    '/api/auth/register',
    { email, password, name },
    { anonymous: true }
  );
  setTokens(data);
  return data;
}

export async function logout(): Promise<void> {
  try {
    // Refresh token is in HttpOnly cookie, sent automatically by browser
    await api.post('/api/auth/logout');
  } finally {
    clearTokens();
  }
}

/** "Log out everywhere" — revokes every session, including this one, then clears local tokens. */
export async function logoutEverywhere(): Promise<void> {
  try {
    await api.post('/api/auth/logout-all');
  } finally {
    clearTokens();
  }
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return api.post('/api/auth/forgot-password', { email }, { anonymous: true });
}

export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return api.post('/api/auth/reset-password', { token, newPassword }, { anonymous: true });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return api.post('/api/auth/verify-email', { token }, { anonymous: true });
}

export async function resendVerificationEmail(): Promise<{ message: string }> {
  return api.post('/api/auth/resend-verification');
}
