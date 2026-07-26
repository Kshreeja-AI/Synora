import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { setTokens, clearTokens } from '../lib/auth/token-storage';

vi.mock('../lib/api/notifications', () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../lib/api/notifications';
import { useNotifications } from './useNotifications';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokens();
  });

  it('never fires the query when there is no access token', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    expect(result.current.notifications).toEqual([]);
    expect(listNotifications).not.toHaveBeenCalled();
  });

  it('exposes the notification list and unread count', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (listNotifications as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [{ id: 'n1', type: 'SECURITY', title: 'Password changed', body: '', link: null, readAt: null, createdAt: '2026-01-01' }],
      unreadCount: 1,
    });

    const { result } = renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(1);
      expect(result.current.notifications).toHaveLength(1);
    });
  });

  it('markRead calls the API with the notification id', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (listNotifications as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: [], unreadCount: 0 });
    (markNotificationRead as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.markRead('n1'));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
  });

  it('markAllRead calls the read-all API', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    (listNotifications as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: [], unreadCount: 0 });
    (markAllNotificationsRead as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.markAllRead());

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalled());
  });
});
