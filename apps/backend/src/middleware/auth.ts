import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@synora/shared';
import { secretsManager } from '../secrets';

export interface AuthRequest extends Request {
  userId?: string;
  /** The RefreshToken row id backing the current access token — see token.service.ts. */
  sessionId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
  /** User's role in current workspace (set by workspace-scoped middleware) */
  userRole?: string;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sid: string;
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
      // Pin the algorithm so "alg: none" / algorithm-substitution tokens are rejected
      return jwt.verify(token, secret, { algorithms: ['HS256'] }) as unknown as JwtPayload;
    } catch {
      continue;
    }
  }

  throw new Error('Token did not verify against any known secret version');
}

/**
 * The access token lives in an httpOnly `accessToken` cookie (see
 * setAuthCookies in routes/auth.ts) since the P0-002 XSS hardening moved it
 * out of the response body; the browser frontend relies on that cookie
 * alone (fetch with credentials: 'include', no Authorization header). A
 * Bearer header is still honored for non-browser API clients.
 */
function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return (req as Request & { cookies?: Record<string, string> }).cookies?.accessToken;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return next(new UnauthorizedException('Missing or invalid authorization header'));
  }

  try {
    const decoded = await verifyToken(token);
    req.userId = decoded.userId;
    req.sessionId = decoded.sid;
    req.user = { id: decoded.userId, email: decoded.email, role: decoded.role };
    next();
  } catch {
    next(new UnauthorizedException('Invalid or expired token'));
  }
}

export async function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (token) {
    try {
      const decoded = await verifyToken(token);
      req.userId = decoded.userId;
      req.sessionId = decoded.sid;
      req.user = { id: decoded.userId, email: decoded.email, role: decoded.role };
    } catch {
      // If token is invalid, continue without authentication
    }
  }

  next();
}
