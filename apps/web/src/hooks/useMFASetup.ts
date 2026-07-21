'use client';

import { useState, useCallback } from 'react';

interface MFASetupState {
  step: 'idle' | 'initiating' | 'qr-ready' | 'verifying' | 'confirming' | 'complete' | 'error';
  setupToken: string | null;
  secret: string | null;
  qrCode: string | null;
  recoveryCodes: string[] | null;
  expiresAt: Date | null;
  error: string | null;
  isLoading: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Hook for managing MFA setup flow
 * Handles: initiate → verify code → save recovery codes → confirm
 */
export function useMFASetup() {
  const [state, setState] = useState<MFASetupState>({
    step: 'idle',
    setupToken: null,
    secret: null,
    qrCode: null,
    recoveryCodes: null,
    expiresAt: null,
    error: null,
    isLoading: false,
  });

  /**
   * Step 1: Initiate MFA setup
   * Request QR code + secret from server
   */
  const initiate = useCallback(async () => {
    setState((prev) => ({ ...prev, step: 'initiating', isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_URL}/auth/mfa/setup/initiate`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to initiate MFA setup');
      }

      const data = await response.json();

      setState((prev) => ({
        ...prev,
        step: 'qr-ready',
        setupToken: data.data.setupToken,
        secret: data.data.secret,
        qrCode: data.data.qrCode,
        expiresAt: new Date(data.data.expiresAt),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start MFA setup';
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: message,
        isLoading: false,
      }));
    }
  }, []);

  /**
   * Step 2: Verify TOTP code from authenticator
   * Shows user their recovery codes
   */
  const verifyCode = useCallback(async (code: string) => {
    if (!state.setupToken) {
      setState((prev) => ({ ...prev, error: 'Setup token missing' }));
      return;
    }

    setState((prev) => ({ ...prev, step: 'verifying', isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_URL}/auth/mfa/setup/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          setupToken: state.setupToken,
          code,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Invalid code');
      }

      const data = await response.json();

      setState((prev) => ({
        ...prev,
        step: 'confirming',
        recoveryCodes: data.data.recoveryCodes,
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify code';
      setState((prev) => ({
        ...prev,
        step: 'qr-ready',
        error: message,
        isLoading: false,
      }));
    }
  }, [state.setupToken]);

  /**
   * Step 3: Confirm MFA setup complete
   * User has saved recovery codes
   */
  const confirm = useCallback(async () => {
    if (!state.setupToken || !state.recoveryCodes) {
      setState((prev) => ({ ...prev, error: 'Setup data missing' }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_URL}/auth/mfa/setup/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          setupToken: state.setupToken,
          recoveryCodes: state.recoveryCodes,
          recoveryCodesSaved: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to confirm MFA setup');
      }

      setState((prev) => ({
        ...prev,
        step: 'complete',
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm setup';
      setState((prev) => ({
        ...prev,
        error: message,
        isLoading: false,
      }));
    }
  }, [state.setupToken, state.recoveryCodes]);

  /**
   * Reset to idle state
   */
  const reset = useCallback(() => {
    setState({
      step: 'idle',
      setupToken: null,
      secret: null,
      qrCode: null,
      recoveryCodes: null,
      expiresAt: null,
      error: null,
      isLoading: false,
    });
  }, []);

  return {
    ...state,
    initiate,
    verifyCode,
    confirm,
    reset,
  };
}
