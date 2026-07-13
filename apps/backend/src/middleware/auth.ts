import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@synora/shared';

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as {
      userId: string;
      email: string;
      role: string;
    };

    req.userId = decoded.userId;
    req.user = decoded;
    next();
  } catch (error) {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as {
        userId: string;
        email: string;
        role: string;
      };

      req.userId = decoded.userId;
      req.user = decoded;
    } catch (error) {
      // If token is invalid, continue without authentication
    }
  }

  next();
}
