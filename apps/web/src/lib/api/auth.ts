import { api } from './client';
import type { AuthResponse } from './types';
import { setTokens, clearTokens, getRefreshToken } from '../auth/token-storage';

export async function login(
  email: string,
  password: string,
  rememberMe?: boolean
): Promise<AuthResponse> {
  const data = await api.post<AuthResponse>(
    '/api/auth/login',
    { email, password, rememberMe },
    { anonymous: true }
  );
  setTokens(data);
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
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await api.post('/api/auth/logout', { refreshToken });
    }
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
