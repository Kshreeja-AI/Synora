import { Request, Response, NextFunction } from 'express';
import { ForbiddenException } from '@synora/shared';
import { prisma } from '@synora/database';

export async function requireAdminRole(
  req: Request & { userId?: string },
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.userId) {
      throw new ForbiddenException('Unauthorized');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    next();
  } catch (error) {
    next(error);
  }
}
