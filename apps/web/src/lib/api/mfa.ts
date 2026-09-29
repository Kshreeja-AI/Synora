import { api } from './client';
import type { AuthResponse } from './types';

/**
 * Client for the TOTP MFA endpoints (`/api/auth/mfa/*`).
 *
 * Enrollment is a three-step handshake (initiate → verify → confirm) so the
 * factor only activates after the server has proven the authenticator works
 * AND the user has been shown their recovery codes. `verifyChallenge` is the
 * second half of an MFA login and is intentionally anonymous — the caller
 * holds no session yet, only the single-use challenge token from /auth/login.
 */

export interface MfaStatus {
  enabled: boolean;
  type: 'TOTP' | null;
  status: 'SETUP_PENDING' | 'ACTIVE' | 'DISABLED' | 'RECOVERY_MODE' | null;
  enabledAt?: string | null;
  lastUsedAt?: string | null;
  recoveryCodesRemaining?: number;
  recoveryCodesTotal?: number;
}

export interface MfaSetupInitiation {
  setupToken: string;
  secret: string;
  /** otpauth:// URI to render as a QR code / open in an authenticator app. */
  qrCode: string;
  expiresAt: string;
}

export interface MfaSetupVerification {
  /** Plaintext recovery codes — shown exactly once, never retrievable again. */
  recoveryCodes: string[];
  /** Server-side hashes to echo back in confirmSetup. */
  codeHashes: string[];
  setupToken: string;
}

export type MfaVerifyResult = AuthResponse & {
  mfaVerified: true;
  /** Present when a recovery code was used (method drops to RECOVERY_MODE). */
  warning?: string;
};

export async function getMfaStatus(): Promise<MfaStatus> {
  return api.get<MfaStatus>('/api/auth/mfa/status');
}

export async function initiateMfaSetup(): Promise<MfaSetupInitiation> {
  return api.post<MfaSetupInitiation>('/api/auth/mfa/setup/initiate', {});
}

export async function verifyMfaSetup(
  setupToken: string,
  code: string
): Promise<MfaSetupVerification> {
  return api.post<MfaSetupVerification>('/api/auth/mfa/setup/verify', { setupToken, code });
}

export async function confirmMfaSetup(
  setupToken: string,
  codeHashes: string[]
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/auth/mfa/setup/confirm', {
    setupToken,
    recoveryCodes: codeHashes,
  });
}

/** Complete an MFA-gated login with a 6-digit TOTP code. */
export async function verifyMfaChallenge(
  mfaChallengeToken: string,
  code: string
): Promise<MfaVerifyResult> {
  return api.post<MfaVerifyResult>(
    '/api/auth/mfa/verify',
    { mfaChallengeToken, code },
    { anonymous: true }
  );
}

/** Complete an MFA-gated login with a recovery code instead of TOTP. */
export async function verifyMfaChallengeWithRecoveryCode(
  mfaChallengeToken: string,
  recoveryCode: string
): Promise<MfaVerifyResult> {
  return api.post<MfaVerifyResult>(
    '/api/auth/mfa/verify',
    { mfaChallengeToken, recoveryCode },
    { anonymous: true }
  );
}

export async function disableMfa(password: string): Promise<{ mfaEnabled: false }> {
  return api.post<{ mfaEnabled: false }>('/api/auth/mfa/disable', { password });
}

export interface MfaRecoveryCodeInfo {
  codeHash: string;
  /** Stable display identifier (hash prefix) — never the plaintext code. */
  prefix: string;
  usedAt: string | null;
}

export async function getMfaRecoveryCodes(): Promise<{ codes: MfaRecoveryCodeInfo[] }> {
  return api.get<{ codes: MfaRecoveryCodeInfo[] }>('/api/auth/mfa/recovery-codes');
}
