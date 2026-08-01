import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  });

  it('login posts credentials anonymously', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
    });

    await login('ada@example.com', 'pw', true);

    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/login',
      { email: 'ada@example.com', password: 'pw', rememberMe: true },
      { anonymous: true }
    );
  });

  it('register posts to the anonymous register endpoint', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u2', email: 'grace@example.com', name: null, emailVerified: false },
    });

    await register('grace@example.com', 'pw', 'Grace');

    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/register',
      { email: 'grace@example.com', password: 'pw', name: 'Grace' },
      { anonymous: true }
    );
  });

  it('logout calls the logout endpoint', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });

    await logout();

    expect(api.post).toHaveBeenCalledWith('/api/auth/logout');
  });

  it('logout handles network failures gracefully', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    await expect(logout()).rejects.toThrow('network down');
  });

  it('logoutEverywhere posts to logout-all', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ revokedCount: 2 });

    await logoutEverywhere();

    expect(api.post).toHaveBeenCalledWith('/api/auth/logout-all');
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
