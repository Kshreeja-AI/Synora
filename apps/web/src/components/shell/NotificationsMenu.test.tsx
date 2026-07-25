import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

import { useNotifications } from '../../hooks/useNotifications';
import { NotificationsMenu } from './NotificationsMenu';

describe('NotificationsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an unread badge when there are unread notifications', () => {
    (useNotifications as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      notifications: [],
      unreadCount: 3,
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });
    render(<NotificationsMenu />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('shows no badge when there are no unread notifications', () => {
    (useNotifications as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      notifications: [],
      unreadCount: 0,
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });
    render(<NotificationsMenu />);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeDefined();
  });

  it('shows the empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    (useNotifications as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      notifications: [],
      unreadCount: 0,
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });
    render(<NotificationsMenu />);

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText("You're all caught up")).toBeDefined();
  });

  it('marks a notification read when clicked', async () => {
    const user = userEvent.setup();
    const markRead = vi.fn();
    (useNotifications as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      notifications: [
        {
          id: 'n1',
          type: 'SECURITY',
          title: 'Password changed',
          body: 'Your password was changed.',
          link: null,
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
      markRead,
      markAllRead: vi.fn(),
    });
    render(<NotificationsMenu />);

    await user.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));
    await user.click(await screen.findByText('Password changed'));

    expect(markRead).toHaveBeenCalledWith('n1');
  });

  it('marks all notifications read via the header action', async () => {
    const user = userEvent.setup();
    const markAllRead = vi.fn();
    (useNotifications as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      notifications: [
        {
          id: 'n1',
          type: 'SECURITY',
          title: 'Password changed',
          body: 'Your password was changed.',
          link: null,
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
      markRead: vi.fn(),
      markAllRead,
    });
    render(<NotificationsMenu />);

    await user.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));
    await user.click(await screen.findByText('Mark all read'));

    expect(markAllRead).toHaveBeenCalled();
  });
});
