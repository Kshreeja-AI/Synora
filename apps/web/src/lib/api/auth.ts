import { api } from './client';
import type { AuthResponse } from './types';
import { setTokens, clearTokens, getRefreshToken } from '../auth/token-storage';

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await api.post<AuthResponse>('/api/auth/login', { email, password }, { anonymous: true });
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
