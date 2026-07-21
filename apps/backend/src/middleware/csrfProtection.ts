import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { ForbiddenException } from '@synora/shared';
import {
  CsrfManager,
  CSRF_CONFIG,
  extractCsrfToken,
  requiresCsrfProtection,
} from '../utils/csrf';

const prisma = new PrismaClient();

function validateOrigin(req: Request): boolean {
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:3000'];

  if (!origin) {
    return false;
  }

  return allowedOrigins.some((allowed) => origin.startsWith(allowed));
}

/**
 * CSRF Protection Middleware
 * Validates CSRF tokens on state-changing requests with timing-constant comparison
 */
export async function csrfProtectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Only protect state-changing methods
  if (!requiresCsrfProtection(req.method)) {
    return next();
  }

  try {
    // Validate origin header (defense-in-depth)
    if (!validateOrigin(req)) {
      throw new ForbiddenException('CSRF token validation failed');
    }

    const token = extractCsrfToken(req);

    if (!token) {
      throw new ForbiddenException('CSRF token validation failed');
    }

    // Use timing-constant token lookup even if format is invalid
    let tokenHash: string;
    if (CsrfManager.isValidTokenFormat(token)) {
      tokenHash = CsrfManager.hashToken(token);
    } else {
      // Generate fake hash for invalid format (maintains constant timing)
      tokenHash = 'invalid-format-' + crypto.randomBytes(16).toString('hex');
    }

    // Find token in database (always do this for constant timing)
    const csrfToken = await prisma.csrfToken.findUnique({
      where: { tokenHash },
    });

    // Perform all validations after DB lookup
    if (!csrfToken || !CsrfManager.isValidTokenFormat(token)) {
      throw new ForbiddenException('CSRF token validation failed');
    }

    // Check session match (if session is bound)
    if (csrfToken.sessionId && csrfToken.sessionId !== req.sessionID) {
      throw new ForbiddenException('CSRF token validation failed');
    }

    // Check expiry using atomic transaction to prevent race condition
    const result = await prisma.$transaction(async (tx) => {
      // Re-fetch within transaction to ensure current state
      const freshToken = await tx.csrfToken.findUnique({
        where: { tokenHash },
      });

      if (!freshToken) {
        throw new ForbiddenException('CSRF token validation failed');
      }

      // Check expiry
      if (new Date() > freshToken.expiresAt) {
        throw new ForbiddenException('CSRF token validation failed');
      }

      // Check if already used (atomic check)
      if (freshToken.usedAt) {
        throw new ForbiddenException('CSRF token validation failed');
      }

      // Mark token as used atomically
      await tx.csrfToken.update({
        where: { id: freshToken.id },
        data: { usedAt: new Date() },
      });

      // Generate new token atomically
      const newToken = CsrfManager.generateToken();
      const newTokenHash = CsrfManager.hashToken(newToken);
      const expiresAt = CsrfManager.getExpiryTime();

      const created = await tx.csrfToken.create({
        data: {
          tokenHash: newTokenHash,
          expiresAt,
          userId: (req as any).userId || null,
          sessionId: req.sessionID,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      });

      return { newToken, expiresAt };
    });

    // Return token in header (primary) and attach to response
    res.setHeader('X-CSRF-Token', result.newToken);
    res.setHeader('X-CSRF-Expires', result.expiresAt.toISOString());

    // Store token expiry in response locals for response middleware to include in body
    (res as any).locals = (res as any).locals || {};
    (res as any).locals.csrfToken = result.newToken;
    (res as any).locals.csrfExpiry = result.expiresAt;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Rate limiter for CSRF token generation
 * Prevents token enumeration attacks - per-IP limit
 */
export async function rateLimitCsrfGeneration(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    // Count recent CSRF tokens from this specific IP
    const recentTokens = await prisma.csrfToken.count({
      where: {
        ipAddress: ip,
        createdAt: {
          gte: oneMinuteAgo,
        },
      },
    });

    if (recentTokens >= CSRF_CONFIG.RATE_LIMIT_PER_MINUTE) {
      throw new ForbiddenException('CSRF token rate limit exceeded');
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Generate CSRF Token Route Handler
 * Returns a new CSRF token for the client
 * Only hash is stored in database; raw token never persisted
 */
export async function generateCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = CsrfManager.generateToken();
    const tokenHash = CsrfManager.hashToken(token);
    const expiresAt = CsrfManager.getExpiryTime();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Store ONLY hash in database (never store raw token)
    // Use transaction to ensure consistency
    await prisma.$transaction(async (tx) => {
      await tx.csrfToken.create({
        data: {
          tokenHash,
          expiresAt,
          userId: (req as any).userId || null,
          sessionId: req.sessionID,
          ipAddress: ip,
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      });
    });

    // Return token in BOTH header (primary) and body (fallback)
    res.setHeader('X-CSRF-Token', token);
    res.setHeader('X-CSRF-Expires', expiresAt.toISOString());

    res.json({
      success: true,
      data: {
        token,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cleanup job to mark expired CSRF tokens
 * Run periodically (e.g., every 10 minutes)
 * Marks tokens instead of deleting to prevent edge cases with concurrent access
 */
export async function cleanupExpiredCsrfTokens() {
  try {
    const updated = await prisma.csrfToken.updateMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
        usedAt: null, // Only mark if not already used
      },
      data: {
        usedAt: new Date(), // Mark as expired
      },
    });

    if (updated.count > 0) {
      console.log(`Marked ${updated.count} expired CSRF tokens`);
    }
  } catch (error) {
    console.error('Error cleaning up CSRF tokens:', error);
  }
}

/**
 * Schedule periodic cleanup of expired CSRF tokens
 * Call this in your server initialization
 */
export function scheduleCleanup(intervalMinutes: number = 10) {
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(cleanupExpiredCsrfTokens, intervalMs);
  console.log(`CSRF token cleanup scheduled every ${intervalMinutes} minutes`);
}
