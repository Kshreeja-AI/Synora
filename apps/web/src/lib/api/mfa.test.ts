import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import { api } from './client';
import {
  getMfaStatus,
  initiateMfaSetup,
  verifyMfaSetup,
  confirmMfaSetup,
  verifyMfaChallenge,
  verifyMfaChallengeWithRecoveryCode,
  disableMfa,
} from './mfa';
import { login, isMfaChallenge } from './auth';

const post = api.post as unknown as ReturnType<typeof vi.fn>;
const get = api.get as unknown as ReturnType<typeof vi.fn>;

describe('lib/api/mfa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getMfaStatus reads the status endpoint', async () => {
    get.mockResolvedValue({ enabled: false, type: null, status: null });
    const status = await getMfaStatus();
    expect(get).toHaveBeenCalledWith('/api/auth/mfa/status');
    expect(status.enabled).toBe(false);
  });

  it('enrollment steps hit initiate/verify/confirm with the setup token', async () => {
    post.mockResolvedValue({});

    await initiateMfaSetup();
    expect(post).toHaveBeenCalledWith('/api/auth/mfa/setup/initiate', {});

    await verifyMfaSetup('tok', '123456');
    expect(post).toHaveBeenCalledWith('/api/auth/mfa/setup/verify', {
      setupToken: 'tok',
      code: '123456',
    });

    await confirmMfaSetup('tok', ['h1', 'h2']);
    expect(post).toHaveBeenCalledWith('/api/auth/mfa/setup/confirm', {
      setupToken: 'tok',
      recoveryCodes: ['h1', 'h2'],
    });
  });

  it('verifyMfaChallenge posts anonymously — the caller has no session yet', async () => {
    post.mockResolvedValue({ mfaVerified: true, user: { id: 'u1' } });
    await verifyMfaChallenge('challenge', '123456');
    expect(post).toHaveBeenCalledWith(
      '/api/auth/mfa/verify',
      { mfaChallengeToken: 'challenge', code: '123456' },
      { anonymous: true }
    );
  });

  it('recovery-code verification sends recoveryCode instead of code', async () => {
    post.mockResolvedValue({ mfaVerified: true, user: { id: 'u1' } });
    await verifyMfaChallengeWithRecoveryCode('challenge', 'XXXX-YYYY');
    expect(post).toHaveBeenCalledWith(
      '/api/auth/mfa/verify',
      { mfaChallengeToken: 'challenge', recoveryCode: 'XXXX-YYYY' },
      { anonymous: true }
    );
  });

  it('disableMfa sends the confirmation password', async () => {
    post.mockResolvedValue({ mfaEnabled: false });
    await disableMfa('pw');
    expect(post).toHaveBeenCalledWith('/api/auth/mfa/disable', { password: 'pw' });
  });

  it('login surfaces an MFA challenge instead of a session for enrolled accounts', async () => {
    post.mockResolvedValue({
      mfaRequired: true,
      mfaChallengeToken: 'challenge-token',
      expiresAt: '2026-08-03T00:05:00Z',
    });

    const result = await login('ada@example.com', 'pw');

    expect(isMfaChallenge(result)).toBe(true);
    if (isMfaChallenge(result)) {
      expect(result.mfaChallengeToken).toBe('challenge-token');
    }
  });

  it('login still returns a plain session for accounts without MFA', async () => {
    post.mockResolvedValue({
      user: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
    });

    const result = await login('ada@example.com', 'pw');

    expect(isMfaChallenge(result)).toBe(false);
  });
});
