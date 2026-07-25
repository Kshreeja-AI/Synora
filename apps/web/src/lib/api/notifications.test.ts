import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

import { api } from './client';
import { listNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead } from './notifications';

describe('lib/api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listNotifications fetches /api/notifications', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: [], unreadCount: 0 });
    await listNotifications();
    expect(api.get).toHaveBeenCalledWith('/api/notifications');
  });

  it('getUnreadNotificationCount fetches /api/notifications/unread-count', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ unreadCount: 3 });
    await getUnreadNotificationCount();
    expect(api.get).toHaveBeenCalledWith('/api/notifications/unread-count');
  });

  it('markNotificationRead posts to /api/notifications/:id/read', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'n1' });
    await markNotificationRead('n1');
    expect(api.post).toHaveBeenCalledWith('/api/notifications/n1/read');
  });

  it('markAllNotificationsRead posts to /api/notifications/read-all', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });
    await markAllNotificationsRead();
    expect(api.post).toHaveBeenCalledWith('/api/notifications/read-all');
  });
});
