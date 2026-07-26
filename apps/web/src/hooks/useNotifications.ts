'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../lib/api/notifications';
import type { NotificationSummary } from '../lib/api/types';
import { getAccessToken } from '../lib/auth/token-storage';

const NOTIFICATIONS_QUERY_KEY = ['notifications'];
const POLL_INTERVAL_MS = 30_000;

export interface UseNotificationsResult {
  notifications: NotificationSummary[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

/**
 * Polls rather than pushes — there is no websocket/SSE infrastructure yet,
 * so a short interval is the honest way to keep the bell's unread count
 * reasonably fresh without fabricating real-time behavior that isn't there.
 */
export function useNotifications(): UseNotificationsResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: listNotifications,
    enabled: Boolean(getAccessToken()),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
  };
}
