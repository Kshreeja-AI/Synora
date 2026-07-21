import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@synora/shared';
import { secretsManager } from '../secrets';

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Verifies against every known version of JWT_SECRET, newest first, so a
 * token signed just before a rotation still validates during the grace
 * window instead of forcing every logged-in user to re-authenticate the
 * moment the key rotates.
 */
async function verifyToken(token: string): Promise<JwtPayload> {
  const current = await secretsManager.get('JWT_SECRET', 'backend:auth-middleware');
  const history = secretsManager.getVersions('JWT_SECRET');
  const candidates = history.length > 0 ? [...history].reverse().map((v) => v.value) : [current];

  for (const secret of candidates) {
    try {
      return jwt.verify(token, secret) as JwtPayload;
    } catch {
      continue;
    }
  }

  throw new Error('Token did not verify against any known secret version');
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedException('Missing or invalid authorization header'));
  }

  const token = authHeader.substring(7);

  try {
    const decoded = await verifyToken(token);
    req.userId = decoded.userId;
    req.user = decoded;
    next();
  } catch (error) {
    next(new UnauthorizedException('Invalid or expired token'));
  }
}

export async function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = await verifyToken(token);
      req.userId = decoded.userId;
      req.user = decoded;
    } catch {
      // If token is invalid, continue without authentication
    }
  }

  next();
}
