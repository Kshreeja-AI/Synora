import { api } from './client';
import type { NotificationSummary, NotificationsResponse } from './types';

export function listNotifications(): Promise<NotificationsResponse> {
  return api.get<NotificationsResponse>('/api/notifications');
}

export function getUnreadNotificationCount(): Promise<{ unreadCount: number }> {
  return api.get<{ unreadCount: number }>('/api/notifications/unread-count');
}

export function markNotificationRead(id: string): Promise<NotificationSummary> {
  return api.post<NotificationSummary>(`/api/notifications/${id}/read`);
}

export function markAllNotificationsRead(): Promise<{ count: number }> {
  return api.post<{ count: number }>('/api/notifications/read-all');
}
