import { prisma } from '@synora/database';
import { NotFoundException } from '@synora/shared';
import type { NotificationType } from '@synora/database';

/**
 * In-app notifications. Every notification is created at a real event
 * trigger point (password changed, password reset, email verified,
 * workspace created) — there is no synthetic or sample content generated
 * for display purposes.
 */

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const LIST_LIMIT = 50;

export async function createNotification(
  userId: string,
  input: { type: NotificationType; title: string; body: string; link?: string }
): Promise<NotificationSummary> {
  return prisma.notification.create({
    data: {
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}

export async function listNotifications(userId: string): Promise<NotificationSummary[]> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
  });
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<NotificationSummary> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });

  if (!notification || notification.userId !== userId) {
    throw new NotFoundException('Notification');
  }

  if (notification.readAt) {
    return notification;
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
