import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { createApiResponse, createApiError, UnauthorizedException } from '@synora/shared';
import { MFAService } from '../services/mfa/mfa.service';
import { ChallengeTokenService } from '../services/mfa/challenge-token.service';
import { csrfProtectionMiddleware } from '../middleware/csrfProtection';

const prisma = new PrismaClient();

const router = Router();

// Middleware to ensure user is authenticated
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).userId) {
    throw new UnauthorizedException('Authentication required');
  }
  next();
};

const setupSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  setupToken: z.string().min(1, 'Setup token required'),
  recoveryCodesSaved: z.boolean().optional(),
});

const verifySchema = z.object({
  mfaChallengeToken: z.string().min(1, 'Challenge token required'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits').optional(),
  recoveryCode: z.string().optional(),
});

const disableSchema = z.object({
  password: z.string().min(1, 'Password required for confirmation'),
});

/**
 * GET /auth/mfa/status
 * Get user's MFA status
 */
router.get('/status', requireAuth, csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const status = await MFAService.getStatus(userId);

    res.json(
      createApiResponse({
        mfaEnabled: status.enabled,
        type: status.type,
        status: status.status,
        enabledAt: status.enabledAt,
        lastUsedAt: status.lastUsedAt,
        recoveryCodesRemaining: status.recoveryCodesRemaining,
        recoveryCodesTotal: status.recoveryCodesTotal,
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/mfa/setup/initiate
 * Start MFA setup process
 * Returns: setupToken, secret, QR code
 */
router.post('/setup/initiate', requireAuth, csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const result = await MFAService.startSetup(userId);

    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/mfa/setup/verify
 * Verify TOTP code during setup
 * User submits 6-digit code from authenticator
 */
router.post('/setup/verify', requireAuth, csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const { setupToken, code } = setupSchema.parse(req.body);

    const result = await MFAService.verifySetupCode(userId, setupToken, code);

    res.json(
      createApiResponse({
        recoveryCodes: result.recoveryCodes,
        setupToken: result.setupToken,
        nextStep: 'confirm',
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/mfa/setup/confirm
 * Confirm MFA setup completion
 * Creates MFAMethod in database, saves recovery codes
 */
router.post('/setup/confirm', requireAuth, csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const { setupToken, recoveryCodesSaved } = setupSchema.parse(req.body);

    if (!recoveryCodesSaved) {
      throw new UnauthorizedException('You must save recovery codes before proceeding');
    }

    // Validate recovery codes format (CRITICAL: must be valid SHA-256 hashes from server)
    const recoveryCodes = Array.isArray(req.body.recoveryCodes) ? req.body.recoveryCodes : [];
    if (recoveryCodes.length !== 10) {
      throw new UnauthorizedException('All 10 recovery codes required for confirmation');
    }

    // Validate each recovery code is a valid SHA-256 hash (64 hex characters)
    for (const code of recoveryCodes) {
      if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
        throw new UnauthorizedException('Invalid recovery code format - expected 64 hex characters');
      }
    }

    await MFAService.confirmSetup(userId, setupToken, recoveryCodes);

    res.json(
      createApiResponse({
        message: 'MFA setup complete',
        mfaEnabled: true,
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/mfa/verify
 * Verify MFA code during login
 * Called after password verification, before JWT issuance
 */
router.post('/verify', csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const { mfaChallengeToken, code, recoveryCode } = verifySchema.parse(req.body);

    // Get session ID and device info from request
    const sessionId = (req as any).sessionId || 'unknown';
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';

    // Determine if verifying TOTP code or recovery code
    if (code) {
      // Verify and extract userId from challenge token (CRITICAL: must verify token properly)
      const challengeToken = await ChallengeTokenService.verifyToken(mfaChallengeToken, '');
      if (!challengeToken) {
        throw new UnauthorizedException('Invalid or expired challenge token');
      }

      const userId = challengeToken.userId;

      // Verify TOTP code
      await MFAService.verifyChallengeCode(userId, mfaChallengeToken, code);

      // Consume the challenge token (mark as used atomically)
      await ChallengeTokenService.consumeToken(challengeToken.id);

      res.json(
        createApiResponse({
          message: 'MFA verified',
          mfaVerified: true,
        })
      );
    } else if (recoveryCode) {
      // Verify and extract userId from challenge token
      const challengeToken = await ChallengeTokenService.verifyToken(mfaChallengeToken, '');
      if (!challengeToken) {
        throw new UnauthorizedException('Invalid or expired challenge token');
      }

      const userId = challengeToken.userId;

      // Verify recovery code
      const result = await MFAService.verifyChallengeRecoveryCode(
        userId,
        mfaChallengeToken,
        recoveryCode
      );

      // Consume the challenge token
      await ChallengeTokenService.consumeToken(challengeToken.id);

      res.json(
        createApiResponse({
          message: 'MFA verified with recovery code',
          mfaVerified: true,
          warning: result.warning,
        })
      );
    } else {
      throw new UnauthorizedException('Code or recovery code required');
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/mfa/disable
 * Disable MFA (requires password confirmation)
 */
router.post('/disable', requireAuth, csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const { password } = disableSchema.parse(req.body);

    // Verify password (CRITICAL: required before disabling MFA)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcryptjs.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    await MFAService.disable(userId);

    res.json(
      createApiResponse({
        message: 'MFA disabled',
        mfaEnabled: false,
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /auth/mfa/recovery-codes
 * List user's recovery codes (partially masked)
 */
router.get('/recovery-codes', requireAuth, csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const result = await MFAService.getRecoveryCodes(userId);

    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

export default router;
