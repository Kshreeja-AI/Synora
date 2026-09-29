import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import {
  createApiResponse,
  UnauthorizedException,
  ValidationException,
  NotFoundException,
} from '@synora/shared';
import { MFAService } from '../services/mfa/mfa.service';
import { ChallengeTokenService } from '../services/mfa/challenge-token.service';
import { createMFAAuditService, MFAAuditAction } from '../services/mfa/audit.service';
import { createRateLimiterService } from '../services/mfa/rate-limiter.service';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { verifyPassword } from '../services/password.service';
import { issueTokens } from '../services/token.service';
import { setAuthCookies, authPayload, toAuthedUser, deviceMetadata } from '../utils/authSession';
import { logger } from '../utils/logger';

const router: Router = Router();

const auditService = createMFAAuditService(prisma);
const rateLimiter = createRateLimiterService(prisma);

const setupVerifySchema = z.object({
  setupToken: z.string().min(1, 'Setup token required'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

const setupConfirmSchema = z.object({
  setupToken: z.string().min(1, 'Setup token required'),
  recoveryCodes: z.array(z.string().min(1)).min(1, 'Recovery codes required'),
});

const verifySchema = z
  .object({
    mfaChallengeToken: z.string().min(1, 'Challenge token required'),
    code: z
      .string()
      .regex(/^\d{6}$/, 'Code must be 6 digits')
      .optional(),
    recoveryCode: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide exactly one of code or recoveryCode',
  });

const disableSchema = z.object({
  password: z.string().min(1, 'Password required for confirmation'),
});

/** Audit logging must never break the auth flow it is observing. */
async function auditBestEffort(
  userId: string,
  action: MFAAuditAction | string,
  metadata?: Record<string, string | number | boolean | null | undefined>
): Promise<void> {
  try {
    await auditService.log(userId, action, metadata);
  } catch (error) {
    logger.warn('[mfa] audit log write failed', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * GET /api/auth/mfa/status — current enrollment state for the signed-in user.
 */
router.get('/status', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const status = await MFAService.getStatus(req.userId!);
    res.json(createApiResponse(status));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/mfa/setup/initiate — issue a setup token plus the TOTP secret
 * and otpauth URI for the authenticator QR code. Nothing is enabled yet.
 */
router.post('/setup/initiate', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const result = await MFAService.startSetup(req.userId!);
    await auditBestEffort(req.userId!, MFAAuditAction.SETUP_INITIATED);
    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/mfa/setup/verify — prove the authenticator is correctly
 * configured, and hand back the one-and-only plaintext copy of the recovery
 * codes. Still not enabled: the user must confirm they stored them.
 */
router.post('/setup/verify', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { setupToken, code } = setupVerifySchema.parse(req.body);
    const result = await MFAService.verifySetupCode(req.userId!, setupToken, code);
    await auditBestEffort(req.userId!, MFAAuditAction.SETUP_VERIFIED);
    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/mfa/setup/confirm — activate TOTP for the account.
 */
router.post('/setup/confirm', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { setupToken, recoveryCodes } = setupConfirmSchema.parse(req.body);
    const result = await MFAService.confirmSetup(req.userId!, setupToken, recoveryCodes);
    await auditBestEffort(req.userId!, MFAAuditAction.SETUP_COMPLETED);
    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/mfa/verify — redeem a login challenge and, on success,
 * establish the session.
 *
 * This is deliberately unauthenticated: the caller has passed the password
 * step but holds no access token yet, so the challenge token is the only
 * credential. It is single-use, expires in five minutes, and is consumed
 * before any token is minted.
 */
router.post('/verify', async (req, res, next) => {
  try {
    const { mfaChallengeToken, code, recoveryCode } = verifySchema.parse(req.body);

    // The challenge token identifies the user — that is its purpose at this
    // point in the flow, since the client is not yet authenticated.
    const challenge = await ChallengeTokenService.verifyToken(mfaChallengeToken);
    if (!challenge) {
      throw new UnauthorizedException('Invalid or expired challenge token');
    }
    const userId: string = challenge.userId;

    // Per-user throttle on top of the per-method lockout inside MFAService, so
    // code guessing is bounded even across re-issued challenges.
    const limit = code
      ? await rateLimiter.checkVerificationAttempt(userId)
      : await rateLimiter.checkRecoveryCodeAttempt(userId);
    if (limit.isRateLimited) {
      await auditBestEffort(userId, MFAAuditAction.RATE_LIMITED, {
        reason: limit.reason ?? null,
        lockoutUntil: limit.lockoutUntil?.toISOString() ?? null,
      });
      throw new UnauthorizedException('Too many attempts. Please try again later.');
    }

    let recoveryWarning: string | undefined;

    try {
      if (code) {
        await MFAService.verifyChallengeCode(userId, mfaChallengeToken, code);
      } else {
        const result = await MFAService.verifyChallengeRecoveryCode(
          userId,
          mfaChallengeToken,
          recoveryCode!
        );
        recoveryWarning = result.warning;
      }
    } catch (error) {
      await auditBestEffort(
        userId,
        code ? MFAAuditAction.VERIFICATION_FAILED : MFAAuditAction.RECOVERY_CODE_FAILED
      );
      throw error;
    }

    // The verification calls above consume the challenge token as their final
    // step and reject the caller that loses that race, so by this point the
    // token is spent and exactly one request can be issuing a session.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User');
    }

    const tokens = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { ...deviceMetadata(req), rememberMe: challenge.rememberMe ?? false }
    );

    await auditBestEffort(
      userId,
      code ? MFAAuditAction.VERIFICATION_SUCCESS : MFAAuditAction.RECOVERY_CODE_USED
    );

    setAuthCookies(res, tokens);
    res.json(
      createApiResponse({
        ...authPayload(tokens, toAuthedUser(user)),
        mfaVerified: true,
        ...(recoveryWarning ? { warning: recoveryWarning } : {}),
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/mfa/disable — turn MFA off. Requires the account password so
 * a hijacked session cannot silently strip the second factor.
 */
router.post('/disable', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { password } = disableSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || !user.password) {
      throw new UnauthorizedException('Password confirmation is not available for this account');
    }

    const isPasswordValid = await verifyPassword(user.password, password);
    if (!isPasswordValid) {
      await auditBestEffort(req.userId!, MFAAuditAction.DISABLE_FAILED);
      throw new ValidationException('Invalid password');
    }

    const result = await MFAService.disable(req.userId!);
    await auditBestEffort(req.userId!, MFAAuditAction.DISABLED);

    res.json(createApiResponse({ ...result, mfaEnabled: false }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/mfa/recovery-codes — remaining recovery code counts. Codes are
 * stored hashed, so the plaintext is never retrievable after enrollment.
 */
router.get('/recovery-codes', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const result = await MFAService.getRecoveryCodes(req.userId!);
    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

export default router;
