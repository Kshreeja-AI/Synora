import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import {
  createApiResponse,
  ValidationException,
  UnauthorizedException,
  LockedException,
} from '@synora/shared';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  fakeVerifyPassword,
} from '../services/password.service';
import { issueTokens, rotateTokens, revokeRefreshToken } from '../services/token.service';
import { checkLockout, recordFailedLogin, clearLoginLockout } from '../services/lockout.service';

const router: Router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Shape returned on register/login/refresh. `token` is a deprecated alias for
 * `accessToken`, kept only so the current (bearer-token) frontend keeps
 * working until the R2 cookie-auth migration; new clients should read
 * `accessToken` and `refreshToken`.
 */
function authPayload(
  tokens: { accessToken: string; refreshToken: string },
  user?: AuthedUser
): Record<string, unknown> {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    token: tokens.accessToken,
    ...(user ? { user } : {}),
  };
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationException('Email already registered');
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    const tokens = await issueTokens({ userId: user.id, email: user.email, role: user.role });

    res.status(201).json(
      createApiResponse(
        authPayload(tokens, { id: user.id, email: user.email, name: user.name })
      )
    );
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

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

    const tokens = await issueTokens({ userId: user.id, email: user.email, role: user.role });

    res.json(
      createApiResponse(
        authPayload(tokens, { id: user.id, email: user.email, name: user.name })
      )
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Exchange a valid refresh token for a new access+refresh pair, rotating the
 * refresh token. An unknown, revoked, or expired token yields 401 — the
 * client must then re-authenticate.
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);

    const tokens = await rotateTokens(refreshToken);
    if (!tokens) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

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
 */
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = logoutSchema.parse(req.body);
    await revokeRefreshToken(refreshToken);
    res.json(createApiResponse({ message: 'Logged out successfully' }));
  } catch (error) {
    next(error);
  }
});

export default router;
