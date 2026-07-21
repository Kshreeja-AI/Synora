'use client';

import { useEffect, useState, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000; // Start with 1s, exponential backoff

// Module-level memory cache (not persisted across page reload)
// This prevents XSS attacks that target localStorage/sessionStorage
let cachedToken: string | null = null;
let cachedExpiry: Date | null = null;
let fetchAbortController: AbortController | null = null;

interface CsrfTokenState {
  token: string | null;
  isLoading: boolean;
  error: Error | null;
  expiresAt: Date | null;
}

/**
 * Hook for managing CSRF tokens with memory-only storage (XSS-safe)
 * Tokens are never persisted to localStorage/sessionStorage
 */
export function useCsrfToken() {
  const [state, setState] = useState<CsrfTokenState>({
    token: null,
    isLoading: true,
    error: null,
    expiresAt: null,
  });

  const [retryCount, setRetryCount] = useState(0);

  /**
   * Fetch new CSRF token from backend
   * Implements exponential backoff retry on network failure
   */
  const fetchToken = useCallback(
    async (signal?: AbortSignal): Promise<string> => {
      try {
        const response = await fetch(`${API_URL}/auth/csrf`, {
          signal,
          credentials: 'include', // Include cookies in request
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.data || !data.data.token) {
          throw new Error('Invalid CSRF token response from server');
        }

        return data.data.token;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Token fetch was cancelled');
        }
        throw error;
      }
    },
    []
  );

  /**
   * Check if cached token is still valid
   */
  const isCachedTokenValid = useCallback((): boolean => {
    if (!cachedToken || !cachedExpiry) {
      return false;
    }

    const now = new Date();
    const refreshThreshold = 5 * 60 * 1000; // Refresh if < 5 min remaining

    return cachedExpiry.getTime() - now.getTime() > refreshThreshold;
  }, []);

  /**
   * Initialize or refresh token with automatic retry on failure
   */
  const initializeToken = useCallback(async () => {
    // Check memory cache first
    if (isCachedTokenValid()) {
      setState({
        token: cachedToken,
        isLoading: false,
        error: null,
        expiresAt: cachedExpiry,
      });
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
    }));

    try {
      // Cancel any previous request
      if (fetchAbortController) {
        fetchAbortController.abort();
      }

      const controller = new AbortController();
      fetchAbortController = controller;

      const token = await fetchToken(controller.signal);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store in memory cache only (never in localStorage/sessionStorage)
      cachedToken = token;
      cachedExpiry = expiresAt;

      setState({
        token,
        isLoading: false,
        error: null,
        expiresAt,
      });

      setRetryCount(0); // Reset retry count on success
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');

      // Retry with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const backoffDelay = RETRY_BACKOFF_MS * Math.pow(2, retryCount);
        setTimeout(() => {
          setRetryCount((r) => r + 1);
        }, backoffDelay);
      } else {
        setState({
          token: null,
          isLoading: false,
          error: err,
          expiresAt: null,
        });
      }
    }
  }, [fetchToken, isCachedTokenValid, retryCount]);

  /**
   * Refresh token (call after receiving 403 CSRF error)
   */
  const refreshToken = useCallback(async (): Promise<string | null> => {
    // Invalidate cache to force fresh fetch
    cachedToken = null;
    cachedExpiry = null;

    try {
      if (fetchAbortController) {
        fetchAbortController.abort();
      }

      const controller = new AbortController();
      fetchAbortController = controller;

      const token = await fetchToken(controller.signal);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      cachedToken = token;
      cachedExpiry = expiresAt;

      setState({
        token,
        isLoading: false,
        error: null,
        expiresAt,
      });

      return token;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to refresh token');
      setState({
        token: null,
        isLoading: false,
        error: err,
        expiresAt: null,
      });
      return null;
    }
  }, [fetchToken]);

  // Initialize on mount
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      if (isMounted) {
        await initializeToken();
      }
    };

    init();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      if (fetchAbortController) {
        fetchAbortController.abort();
      }
    };
  }, [initializeToken]);

  // Retry initialization if retry count changes
  useEffect(() => {
    if (retryCount > 0 && retryCount <= MAX_RETRIES) {
      const backoffDelay = RETRY_BACKOFF_MS * Math.pow(2, retryCount - 1);
      const timer = setTimeout(() => {
        initializeToken();
      }, backoffDelay);

      return () => clearTimeout(timer);
    }
  }, [retryCount, initializeToken]);

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
      credentials: 'include', // Include cookies
      headers,
    });
  };
}
