import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@synora/shared';
import {
  CsrfManager,
  CSRF_CONFIG,
  extractCsrfToken,
  requiresCsrfProtection,
} from '../utils/csrf';

const prisma = new PrismaClient();

/**
 * CSRF Protection Middleware
 * Validates CSRF tokens on state-changing requests
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
    const token = extractCsrfToken(req);

    if (!token) {
      throw new ForbiddenException('CSRF token missing');
    }

    // Validate token format
    if (!CsrfManager.isValidTokenFormat(token)) {
      throw new ForbiddenException('CSRF token invalid');
    }

    // Hash token for database lookup
    const tokenHash = CsrfManager.hashToken(token);

    // Find token in database
    const csrfToken = await prisma.csrfToken.findUnique({
      where: { tokenHash },
    });

    if (!csrfToken) {
      throw new ForbiddenException('CSRF token not found');
    }

    // Check if token is expired
    if (new Date() > csrfToken.expiresAt) {
      throw new ForbiddenException('CSRF token expired');
    }

    // Check if token has already been used
    if (csrfToken.usedAt) {
      throw new ForbiddenException('CSRF token already used');
    }

    // Mark token as used (consume it)
    await prisma.csrfToken.update({
      where: { id: csrfToken.id },
      data: { usedAt: new Date() },
    });

    // Generate new token for response
    const newToken = CsrfManager.generateToken();
    const newTokenHash = CsrfManager.hashToken(newToken);
    const expiresAt = CsrfManager.getExpiryTime();

    await prisma.csrfToken.create({
      data: {
        token: newToken,
        tokenHash: newTokenHash,
        expiresAt,
        userId: (req as any).userId || null,
      },
    });

    // Store new token in response for client to use in next request
    res.setHeader('X-CSRF-Token', newToken);

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Generate CSRF Token Route Handler
 * Returns a new CSRF token for the client
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

    // Store token in database
    await prisma.csrfToken.create({
      data: {
        token,
        tokenHash,
        expiresAt,
        userId: (req as any).userId || null,
      },
    });

    // Return token to client
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
 * Rate limiter for CSRF token generation
 * Prevents token enumeration attacks
 */
export async function rateLimitCsrfGeneration(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    // Count recent CSRF tokens from this IP
    const recentTokens = await prisma.csrfToken.count({
      where: {
        createdAt: {
          gte: oneMinuteAgo,
        },
        // Note: We'd need to store IP address to rate limit properly
        // For now, we'll just count all tokens
      },
    });

    // Note: This is a simplified rate limit
    // In production, track IP addresses in CSRF token table
    if (recentTokens > CSRF_CONFIG.RATE_LIMIT_PER_MINUTE * 100) {
      throw new ForbiddenException('Rate limit exceeded: too many token requests');
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Cleanup middleware to remove expired CSRF tokens
 * Run periodically (e.g., every 10 minutes)
 */
export async function cleanupExpiredCsrfTokens() {
  try {
    const deleted = await prisma.csrfToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    console.log(`Cleaned up ${deleted.count} expired CSRF tokens`);
  } catch (error) {
    console.error('Error cleaning up CSRF tokens:', error);
  }
}
