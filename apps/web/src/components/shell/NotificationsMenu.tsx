'use client';

import { Bell, Check, ShieldAlert, UserRound, Building2, Info } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Button,
  Badge,
  EmptyState,
  cn,
} from '@synora/design-system';
import { useNotifications } from '../../hooks/useNotifications';
import type { NotificationSummary, NotificationType } from '../../lib/api/types';

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  SECURITY: ShieldAlert,
  ACCOUNT: UserRound,
  WORKSPACE: Building2,
  SYSTEM: Info,
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: NotificationSummary;
  onRead: (id: string) => void;
}): React.JSX.Element {
  const Icon = TYPE_ICONS[notification.type];
  const isUnread = notification.readAt === null;

  return (
    <button
      type="button"
      onClick={() => {
        if (isUnread) onRead(notification.id);
      }}
      className={cn(
        'flex w-full items-start gap-3 rounded-sm px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent',
        isUnread && 'bg-accent/40'
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 space-y-0.5">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{notification.title}</span>
          {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
        </span>
        <span className="block text-xs text-muted-foreground">{notification.body}</span>
        <span className="block text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</span>
      </span>
    </button>
  );
}

export function NotificationsMenu(): React.JSX.Element {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto gap-1 px-2 py-1 text-xs"
              onClick={(event) => {
                event.preventDefault();
                markAllRead();
              }}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-96 overflow-y-auto p-1">
          {notifications.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              title="You're all caught up"
              description="New activity on your account will show up here."
              className="border-none py-8"
            />
          ) : (
            notifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} onRead={markRead} />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
