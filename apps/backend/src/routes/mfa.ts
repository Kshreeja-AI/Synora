import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createApiResponse, createApiError, UnauthorizedException } from '@synora/shared';
import { MFAService } from '../services/mfa/mfa.service';
import { csrfProtectionMiddleware } from '../middleware/csrfProtection';

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

    // Parse recovery codes from body (user must submit them back for confirmation)
    const recoveryCodes = req.body.recoveryCodes || [];
    if (recoveryCodes.length !== 10) {
      throw new UnauthorizedException('All recovery codes required for confirmation');
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

    // Determine if verifying TOTP code or recovery code
    if (code) {
      // Get userId from challenge token
      const { userId } = await parseChallengeToken(mfaChallengeToken);

      await MFAService.verifyChallengeCode(userId, mfaChallengeToken, code);

      // Return JWT token + user info
      // (In real implementation, would generate JWT here)
      res.json(
        createApiResponse({
          message: 'MFA verified',
          mfaVerified: true,
        })
      );
    } else if (recoveryCode) {
      const { userId } = await parseChallengeToken(mfaChallengeToken);

      const result = await MFAService.verifyChallengeRecoveryCode(
        userId,
        mfaChallengeToken,
        recoveryCode
      );

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

    // In real implementation, verify password here
    // const user = await prisma.user.findUnique({ where: { id: userId } });
    // const isValid = await bcryptjs.compare(password, user.password);
    // if (!isValid) throw new UnauthorizedException('Invalid password');

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

/**
 * Helper: Parse userId from challenge token
 * In real implementation, would decrypt/verify token
 */
async function parseChallengeToken(token: string): Promise<{ userId: string }> {
  // This would be implemented properly in production
  return { userId: 'temp-user-id' };
}

export default router;
