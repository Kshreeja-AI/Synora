'use client';

import { useEffect, useState } from 'react';

const CSRF_TOKEN_KEY = 'csrf-token';
const CSRF_EXPIRY_KEY = 'csrf-expiry';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface CsrfTokenState {
  token: string | null;
  isLoading: boolean;
  error: Error | null;
  expiresAt: Date | null;
}

/**
 * Hook for managing CSRF tokens
 * Handles token fetching, caching, and refresh logic
 */
export function useCsrfToken() {
  const [state, setState] = useState<CsrfTokenState>({
    token: null,
    isLoading: true,
    error: null,
    expiresAt: null,
  });

  /**
   * Fetch new CSRF token from backend
   */
  const fetchToken = async (): Promise<string> => {
    try {
      const response = await fetch(`${API_URL}/auth/csrf`);

      if (!response.ok) {
        throw new Error(`Failed to fetch CSRF token: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.data || !data.data.token) {
        throw new Error('Invalid CSRF token response');
      }

      const token = data.data.token;
      const expiresAt = new Date(data.data.expiresAt);

      // Cache token in sessionStorage
      sessionStorage.setItem(CSRF_TOKEN_KEY, token);
      sessionStorage.setItem(CSRF_EXPIRY_KEY, expiresAt.toISOString());

      return token;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      setState((prev) => ({
        ...prev,
        error: err,
        isLoading: false,
      }));
      throw err;
    }
  };

  /**
   * Check if cached token is still valid
   */
  const isCachedTokenValid = (): boolean => {
    const cachedToken = sessionStorage.getItem(CSRF_TOKEN_KEY);
    const cachedExpiry = sessionStorage.getItem(CSRF_EXPIRY_KEY);

    if (!cachedToken || !cachedExpiry) {
      return false;
    }

    const expiryTime = new Date(cachedExpiry);
    const now = new Date();

    // Refresh token if it expires in less than 5 minutes
    return expiryTime.getTime() - now.getTime() > 5 * 60 * 1000;
  };

  /**
   * Initialize or refresh token
   */
  const initializeToken = async () => {
    // Check if cached token is valid
    if (isCachedTokenValid()) {
      const cachedToken = sessionStorage.getItem(CSRF_TOKEN_KEY);
      const cachedExpiry = sessionStorage.getItem(CSRF_EXPIRY_KEY);

      if (cachedToken && cachedExpiry) {
        setState({
          token: cachedToken,
          isLoading: false,
          error: null,
          expiresAt: new Date(cachedExpiry),
        });
        return;
      }
    }

    // Fetch new token
    try {
      const token = await fetchToken();
      const cachedExpiry = sessionStorage.getItem(CSRF_EXPIRY_KEY);

      setState({
        token,
        isLoading: false,
        error: null,
        expiresAt: cachedExpiry ? new Date(cachedExpiry) : null,
      });
    } catch {
      setState((prev) => ({
        ...prev,
        isLoading: false,
      }));
    }
  };

  /**
   * Refresh token (call after receiving 403 CSRF error)
   */
  const refreshToken = async (): Promise<string | null> => {
    try {
      const token = await fetchToken();
      setState({
        token,
        isLoading: false,
        error: null,
        expiresAt: new Date(
          Date.now() + 60 * 60 * 1000 // 1 hour
        ),
      });
      return token;
    } catch (error) {
      return null;
    }
  };

  // Initialize on mount
  useEffect(() => {
    initializeToken();
  }, []);

  return {
    token: state.token,
    isLoading: state.isLoading,
    error: state.error,
    expiresAt: state.expiresAt,
    refreshToken,
  };
}

/**
 * Create fetch wrapper with automatic CSRF token inclusion
 */
export function createFetchWithCsrf(token: string | null) {
  return async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const method = (options.method || 'GET').toUpperCase();
    const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

    const headers = {
      ...options.headers,
      'Content-Type': 'application/json',
    } as Record<string, string>;

    // Add CSRF token to state-changing requests
    if (isStateChanging && token) {
      headers['X-CSRF-Token'] = token;
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };
}
