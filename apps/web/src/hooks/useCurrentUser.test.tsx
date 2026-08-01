import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { useAuthStore } from '../stores/auth-store';

vi.mock('../lib/api/account', () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from '../lib/api/account';
import { useCurrentUser } from './useCurrentUser';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, status: 'loading' });
  });

  it('fetches the current user (tokens in HttpOnly cookies)', async () => {
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada',
      image: null,
      role: 'USER',
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      profile: null,
      preferences: { theme: 'DARK', emailNotifications: true, pushNotifications: false, marketingEmails: false },
    });

    renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => {
      expect(useAuthStore.getState().user?.email).toBe('ada@example.com');
      expect(useAuthStore.getState().status).toBe('authenticated');
    });
  });

  it('clears the auth store session when the fetch fails', async () => {
    useAuthStore.setState({ user: { id: 'u1', email: 'x@y.co', name: null, emailVerified: false }, status: 'authenticated' });
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unauthorized'));

    renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => {
      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(useAuthStore.getState().user).toBeNull();
    });
  });
});
