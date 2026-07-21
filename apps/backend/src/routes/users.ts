import { Router } from 'express';
import { prisma } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException } from '@synora/shared';

const router: Router = Router();

router.get('/me', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User');
    }

    res.json(createApiResponse(user));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        image: true,
        profile: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User');
    }

    res.json(createApiResponse(user));
  } catch (error) {
    next(error);
  }
});

export default router;
