import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import {
  createApiResponse,
  ValidationException,
  UnauthorizedException,
  NotFoundException,
  LockedException,
} from '@synora/shared';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  fakeVerifyPassword,
} from '../services/password.service';
import { issueTokens, rotateTokens, revokeRefreshToken, revokeAllUserTokens } from '../services/token.service';
import { checkLockout, recordFailedLogin, clearLoginLockout } from '../services/lockout.service';
import { issuePasswordResetToken, consumePasswordResetToken } from '../services/passwordReset.service';
import {
  issueEmailVerificationToken,
  consumeEmailVerificationToken,
} from '../services/emailVerification.service';
import { listSessions, revokeSession, revokeAllSessions } from '../services/session.service';
import { MFAService } from '../services/mfa/mfa.service';
import {
  toAuthedUser,
  setAuthCookies,
  authPayload,
  deviceMetadata,
} from '../utils/authSession';
import { createNotification } from '../services/notification.service';
import { assertRegistrationAllowed } from '../services/registrationPolicy';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} from '../mail';
import { logger } from '../utils/logger';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  refreshTokenLimiter,
} from '../middleware/authRateLimit';
import { authInputValidator } from '../middleware/inputValidation';

const router: Router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});


/**
 * Mail delivery is best-effort from the caller's point of view: a mailer
 * outage must never fail registration, login, password reset, or account
 * changes that already succeeded on the data they're supposed to reflect.
 * Failures are logged for operational visibility instead.
 */
async function sendMailBestEffort(label: string, send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    logger.warn(`[auth] ${label} email failed to send`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Same best-effort discipline as mail: an in-app notification must never fail the operation it records. */
async function notifyBestEffort(label: string, notify: () => Promise<unknown>): Promise<void> {
  try {
    await notify();
  } catch (error) {
    logger.warn(`[auth] ${label} notification failed to create`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

router.post('/register', authInputValidator, registerLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    // Closed beta: REGISTRATION_MODE=invite (the default). Checked before the
    // "already registered" lookup so a stranger learns nothing about who has an account.
    await assertRegistrationAllowed(email);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationException('Email already registered');
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    const tokens = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      deviceMetadata(req)
    );

    const verificationToken = await issueEmailVerificationToken(user.id);
    await sendMailBestEffort('verification', () =>
      sendVerificationEmail({ to: user.email, name: user.name, token: verificationToken })
    );

    setAuthCookies(res, tokens);
    res.status(201).json(createApiResponse(authPayload(tokens, toAuthedUser(user))));
  } catch (error) {
    next(error);
  }
});

router.post('/login', authInputValidator, loginLimiter, async (req, res, next) => {
  try {
    const { email, password, rememberMe } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      // Spend the same verification time a real account would, so response
      // timing cannot distinguish a registered email from an unregistered
      // one. The message is identical to the wrong-password case below.
      await fakeVerifyPassword(password);
      throw new ValidationException('Invalid email or password');
    }

    // Checked before verifying the password: a locked account must reject
    // every attempt for the lockout duration, including a correct password —
    // otherwise lockout would only ever stop guessing, not a lucky guess.
    const lockout = checkLockout(user);
    if (lockout.isLocked) {
      throw new LockedException(
        'Account temporarily locked due to too many failed login attempts. Try again later.',
        { lockedUntil: lockout.lockedUntil!.toISOString() }
      );
    }

    const isPasswordValid = await verifyPassword(user.password, password);
    if (!isPasswordValid) {
      await recordFailedLogin(user.id);
      throw new ValidationException('Invalid email or password');
    }

    // Transparent migration: a correct password against a legacy bcrypt hash
    // (or an Argon2 hash with outdated parameters) is re-hashed with the
    // current Argon2id settings and persisted here. No user-visible change,
    // no forced reset — every successful login gradually migrates the stored
    // hash population off bcrypt.
    await clearLoginLockout(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(needsRehash(user.password) ? { password: await hashPassword(password) } : {}),
      },
    });

    // Second factor gate. The password is correct, but for an MFA-enrolled
    // account that is only half the proof — so no tokens and no cookies are
    // issued here. The caller gets a short-lived, single-use challenge token
    // to redeem at POST /auth/mfa/verify, which is where the session is
    // actually established. Accounts without MFA are unaffected and still
    // receive tokens in this same response, so existing clients keep working.
    if (await MFAService.isEnabled(user.id)) {
      const challenge = await MFAService.generateChallenge(
        user.id,
        'login',
        req.ip ?? 'unknown',
        req.headers['user-agent'] ?? 'unknown',
        rememberMe ?? false
      );

      res.json(
        createApiResponse({
          mfaRequired: true,
          mfaChallengeToken: challenge.mfaChallengeToken,
          expiresAt: challenge.expiresAt,
        })
      );
      return;
    }

    const tokens = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { ...deviceMetadata(req), rememberMe }
    );

    setAuthCookies(res, tokens);
    res.json(createApiResponse(authPayload(tokens, toAuthedUser(user))));
  } catch (error) {
    next(error);
  }
});

/**
 * Exchange a valid refresh token for a new access+refresh pair, rotating the
 * refresh token. An unknown, revoked, or expired token yields 401 — the
 * client must then re-authenticate.
 *
 * Reads refresh token from HttpOnly cookie (preferred) or request body (for backwards compatibility).
 */
router.post('/refresh', authInputValidator, refreshTokenLimiter, async (req, res, next) => {
  try {
    const refreshToken = req.cookies['refreshToken'] || req.body.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing or expired');
    }

    const tokens = await rotateTokens(refreshToken, deviceMetadata(req));
    if (!tokens) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    setAuthCookies(res, tokens);
    res.json(createApiResponse(authPayload(tokens)));
  } catch (error) {
    next(error);
  }
});

/**
 * Revoke the presented refresh token. This is what makes logout real: the
 * short-lived access token expires within minutes, and without a live refresh
 * token no new access token can be minted. Idempotent — a stale or already
 * revoked token still returns success.
 *
 * Reads refresh token from HttpOnly cookie (preferred) or request body (for backwards compatibility).
 * Clears auth cookies after logout.
 */
router.post('/logout', authInputValidator, async (req, res, next) => {
  try {
    const refreshToken = req.cookies['refreshToken'] || req.body.refreshToken;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
    res.json(createApiResponse({ message: 'Logged out successfully' }));
  } catch (error) {
    next(error);
  }
});

/**
 * Never reveals whether an email is registered: the response shape and
 * status code are identical whether or not a matching account exists.
 */
router.post('/forgot-password', authInputValidator, forgotPasswordLimiter, async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.password) {
      const token = await issuePasswordResetToken(user.id);
      await sendMailBestEffort('password-reset', () =>
        sendPasswordResetEmail({ to: user.email, name: user.name, token })
      );
    }

    res.json(
      createApiResponse({
        message: 'If an account exists for that email, a password reset link has been sent.',
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Consuming a valid reset token revokes every active session — the reset
 * link is trusted to represent regained account control, and every other
 * live token (potentially the attacker's, if this reset was defensive)
 * must not survive it.
 */
router.post('/reset-password', authInputValidator, async (req, res, next) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    const consumed = await consumePasswordResetToken(token);
    if (!consumed) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const hashedPassword = await hashPassword(newPassword);
    const user = await prisma.user.update({
      where: { id: consumed.userId },
      data: { password: hashedPassword, failedLoginAttempts: 0, lockedUntil: null },
    });

    await revokeAllUserTokens(user.id);
    await sendMailBestEffort('password-changed', () =>
      sendPasswordChangedEmail({ to: user.email, name: user.name })
    );
    await notifyBestEffort('password-reset', () =>
      createNotification(user.id, {
        type: 'SECURITY',
        title: 'Password reset',
        body: 'Your password was reset. If this wasn’t you, contact support immediately.',
      })
    );

    res.json(createApiResponse({ message: 'Password reset successfully. Please sign in.' }));
  } catch (error) {
    next(error);
  }
});

router.post('/verify-email', authInputValidator, async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);

    const consumed = await consumeEmailVerificationToken(token);
    if (!consumed) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await notifyBestEffort('email-verified', () =>
      createNotification(consumed.userId, {
        type: 'ACCOUNT',
        title: 'Email verified',
        body: 'Your email address has been verified.',
      })
    );

    res.json(createApiResponse({ message: 'Email verified successfully.' }));
  } catch (error) {
    next(error);
  }
});

/** Requires auth: resend to whoever is asking, never to an arbitrary email address. */
router.post('/resend-verification', authInputValidator, authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      throw new NotFoundException('User');
    }

    if (user.emailVerified) {
      res.json(createApiResponse({ message: 'Email is already verified.' }));
      return;
    }

    const token = await issueEmailVerificationToken(user.id);
    await sendMailBestEffort('verification', () =>
      sendVerificationEmail({ to: user.email, name: user.name, token })
    );

    res.json(createApiResponse({ message: 'Verification email sent.' }));
  } catch (error) {
    next(error);
  }
});

/** Active sessions/devices for the signed-in user, most recently used first. */
router.get('/sessions', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const sessions = await listSessions(req.userId!, req.sessionId);
    res.json(createApiResponse(sessions));
  } catch (error) {
    next(error);
  }
});

/** Revoke a single session — must belong to the caller. */
router.delete('/sessions/:id', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const revoked = await revokeSession(req.userId!, req.params.id);
    if (!revoked) {
      throw new NotFoundException('Session');
    }
    res.json(createApiResponse({ message: 'Session revoked.' }));
  } catch (error) {
    next(error);
  }
});

/** "Log out everywhere" — revokes every active session, including the caller's own. */
router.post('/logout-all', authInputValidator, authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const count = await revokeAllSessions(req.userId!);
    res.json(createApiResponse({ revokedCount: count }));
  } catch (error) {
    next(error);
  }
});

export default router;
