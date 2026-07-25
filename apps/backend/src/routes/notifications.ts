import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import {
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notification.service';

const router: Router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(req.userId!),
      countUnreadNotifications(req.userId!),
    ]);
    res.json(createApiResponse({ notifications, unreadCount }));
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const unreadCount = await countUnreadNotifications(req.userId!);
    res.json(createApiResponse({ unreadCount }));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/read', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const notification = await markNotificationRead(req.userId!, req.params.id);
    res.json(createApiResponse(notification));
  } catch (error) {
    next(error);
  }
});

router.post('/read-all', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const count = await markAllNotificationsRead(req.userId!);
    res.json(createApiResponse({ count }));
  } catch (error) {
    next(error);
  }
});

export default router;
