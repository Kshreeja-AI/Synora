import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../auth/token-storage';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { post: vi.fn() } };
});

import { api } from './client';
import {
  login,
  register,
  logout,
  logoutEverywhere,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
} from './auth';

describe('lib/api/auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokens();
  });

  it('login posts credentials anonymously and stores the returned tokens', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'a1',
      refreshToken: 'r1',
      user: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
    });

    await login('ada@example.com', 'pw', true);

    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/login',
      { email: 'ada@example.com', password: 'pw', rememberMe: true },
      { anonymous: true }
    );
    expect(getAccessToken()).toBe('a1');
    expect(getRefreshToken()).toBe('r1');
  });

  it('register posts to the anonymous register endpoint and stores tokens', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'a2',
      refreshToken: 'r2',
      user: { id: 'u2', email: 'grace@example.com', name: null, emailVerified: false },
    });

    await register('grace@example.com', 'pw', 'Grace');

    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/register',
      { email: 'grace@example.com', password: 'pw', name: 'Grace' },
      { anonymous: true }
    );
    expect(getAccessToken()).toBe('a2');
  });

  it('logout revokes the refresh token then clears local tokens even on failure', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (api.post as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    await expect(logout()).rejects.toThrow('network down');
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('logout is a no-op network call when there is no refresh token, but still clears storage', async () => {
    await logout();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('logoutEverywhere posts to logout-all and clears local tokens', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ revokedCount: 2 });

    await logoutEverywhere();

    expect(api.post).toHaveBeenCalledWith('/api/auth/logout-all');
    expect(getAccessToken()).toBeNull();
  });

  it('forgotPassword posts anonymously', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await forgotPassword('ada@example.com');
    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/forgot-password',
      { email: 'ada@example.com' },
      { anonymous: true }
    );
  });

  it('resetPassword posts the token and new password anonymously', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await resetPassword('raw-token', 'new-password-123');
    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/reset-password',
      { token: 'raw-token', newPassword: 'new-password-123' },
      { anonymous: true }
    );
  });

  it('verifyEmail posts the token anonymously', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await verifyEmail('raw-token');
    expect(api.post).toHaveBeenCalledWith('/api/auth/verify-email', { token: 'raw-token' }, { anonymous: true });
  });

  it('resendVerificationEmail posts authenticated (no anonymous flag)', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    await resendVerificationEmail();
    expect(api.post).toHaveBeenCalledWith('/api/auth/resend-verification');
  });
});
