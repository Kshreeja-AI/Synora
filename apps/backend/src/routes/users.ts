import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, NotFoundException, ValidationException, UnauthorizedException } from '@synora/shared';
import { hashPassword, verifyPassword, fakeVerifyPassword } from '../services/password.service';
import { revokeAllUserTokens, revokeAllUserTokensExcept } from '../services/token.service';
import { uploadAvatar, deleteAvatar, avatarKeyFromUrl, isAllowedAvatarContentType } from '../storage';
import { sendPasswordChangedEmail, sendAccountDeletedEmail } from '../mail';
import { createNotification } from '../services/notification.service';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

const router: Router = Router();

// A generous module-scope ceiling for multer itself (this file is imported
// before config is initialized, so it can't read the real configured limit
// here); the actual configured max (`storage.maxUploadBytes`) is enforced
// inside the handler, where getConfig() is safe to call.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(500).optional(),
  website: z.string().trim().url().max(300).optional().or(z.literal('')),
  location: z.string().trim().max(100).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

const updatePreferencesSchema = z.object({
  theme: z.enum(['LIGHT', 'DARK', 'AUTO']).optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
});

/** Best-effort mail delivery — never fails an operation that already succeeded on its own data. */
async function sendMailBestEffort(label: string, send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    logger.warn(`[users] ${label} email failed to send`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Same best-effort discipline as mail: an in-app notification must never fail the operation it records. */
async function notifyBestEffort(label: string, notify: () => Promise<unknown>): Promise<void> {
  try {
    await notify();
  } catch (error) {
    logger.warn(`[users] ${label} notification failed to create`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

router.get('/me', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        emailVerified: true,
        onboardedAt: true,
        createdAt: true,
        profile: { select: { bio: true, website: true, location: true } },
        preferences: {
          select: { theme: true, emailNotifications: true, pushNotifications: true, marketingEmails: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User');
    }

    res.json(
      createApiResponse({
        ...user,
        emailVerified: user.emailVerified !== null,
        preferences: user.preferences ?? {
          theme: 'AUTO',
          emailNotifications: true,
          pushNotifications: false,
          marketingEmails: false,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

router.patch('/me', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { name, bio, website, location } = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(bio !== undefined || website !== undefined || location !== undefined
          ? {
              profile: {
                upsert: {
                  create: { bio, website: website || undefined, location },
                  update: { bio, website: website || undefined, location },
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        emailVerified: true,
        profile: { select: { bio: true, website: true, location: true } },
      },
    });

    res.json(createApiResponse({ ...user, emailVerified: user.emailVerified !== null }));
  } catch (error) {
    next(error);
  }
});

router.post('/me/avatar', authMiddleware, upload.single('avatar'), async (req: AuthRequest, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      throw new ValidationException('No avatar file provided.');
    }
    if (!isAllowedAvatarContentType(file.mimetype)) {
      throw new ValidationException('Unsupported avatar file type. Use PNG, JPEG, WEBP, or GIF.');
    }
    if (file.size > getConfig().storage.maxUploadBytes) {
      throw new ValidationException(
        `Avatar file is too large. Maximum size is ${Math.floor(getConfig().storage.maxUploadBytes / 1024 / 1024)}MB.`
      );
    }

    const previous = await prisma.user.findUnique({ where: { id: req.userId }, select: { image: true } });

    const uploaded = await uploadAvatar({ userId: req.userId!, buffer: file.buffer, contentType: file.mimetype });

    await prisma.user.update({ where: { id: req.userId }, data: { image: uploaded.url } });

    if (previous?.image) {
      const previousKey = avatarKeyFromUrl(previous.image);
      if (previousKey) {
        await deleteAvatar(previousKey).catch((error) =>
          logger.warn('[users] failed to delete previous avatar', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    res.json(createApiResponse({ image: uploaded.url }));
  } catch (error) {
    next(error);
  }
});

router.delete('/me/avatar', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { image: true } });

    if (user?.image) {
      const key = avatarKeyFromUrl(user.image);
      if (key) {
        await deleteAvatar(key).catch((error) =>
          logger.warn('[users] failed to delete avatar', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    await prisma.user.update({ where: { id: req.userId }, data: { image: null } });
    res.json(createApiResponse({ message: 'Avatar removed.' }));
  } catch (error) {
    next(error);
  }
});

/**
 * Verifies the current password, then rotates to the new one and revokes
 * every other active session — the device making this change stays signed
 * in, everything else is treated the way a stolen-password scenario would
 * require.
 */
router.post('/me/password', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !user.password) {
      await fakeVerifyPassword(currentPassword);
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const isValid = await verifyPassword(user.password, currentPassword);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(newPassword) },
    });

    if (req.sessionId) {
      await revokeAllUserTokensExcept(user.id, req.sessionId);
    } else {
      await revokeAllUserTokens(user.id);
    }

    await sendMailBestEffort('password-changed', () =>
      sendPasswordChangedEmail({ to: user.email, name: user.name })
    );
    await notifyBestEffort('password-changed', () =>
      createNotification(user.id, {
        type: 'SECURITY',
        title: 'Password changed',
        body: 'Your password was changed. If this wasn’t you, contact support immediately.',
      })
    );

    res.json(createApiResponse({ message: 'Password changed successfully.' }));
  } catch (error) {
    next(error);
  }
});

router.get('/me/preferences', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const preferences = await prisma.userPreferences.findUnique({ where: { userId: req.userId } });
    res.json(
      createApiResponse(
        preferences ?? {
          theme: 'AUTO',
          emailNotifications: true,
          pushNotifications: false,
          marketingEmails: false,
        }
      )
    );
  } catch (error) {
    next(error);
  }
});

router.patch('/me/preferences', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const updates = updatePreferencesSchema.parse(req.body);

    const preferences = await prisma.userPreferences.upsert({
      where: { userId: req.userId },
      create: {
        userId: req.userId!,
        theme: updates.theme ?? 'AUTO',
        emailNotifications: updates.emailNotifications ?? true,
        pushNotifications: updates.pushNotifications ?? false,
        marketingEmails: updates.marketingEmails ?? false,
      },
      update: updates,
    });

    res.json(createApiResponse(preferences));
  } catch (error) {
    next(error);
  }
});

/**
 * Soft-deletes the account: the row is kept (preserving referential
 * integrity for owned projects/documents/activity) but marked DELETED,
 * every session is revoked, and the email is freed up for reuse by
 * mangling it — a deleted account must never block someone else (or the
 * same person) from registering that address again.
 */
/**
 * POST /api/users/me/onboarded — mark the caller as onboarded.
 *
 * Idempotent: called multiple times, the first-set timestamp is preserved so
 * we know when the user actually finished the flow (not when they most
 * recently reopened the app). Frontend calls this when they either complete
 * the welcome wizard or explicitly skip it — either way, they've been given
 * the opportunity, so the redirect gate should stop firing.
 */
router.post('/me/onboarded', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { onboardedAt: true },
    });
    if (!user) throw new NotFoundException('User');

    const updated = await prisma.user.update({
      where: { id: req.userId },
      // First completion wins; a repeat call is a no-op on the timestamp so
      // analytics on "days from signup to onboarded" stays honest.
      data: user.onboardedAt ? {} : { onboardedAt: new Date() },
      select: { onboardedAt: true },
    });

    res.json(createApiResponse({ onboardedAt: updated.onboardedAt }));
  } catch (error) {
    next(error);
  }
});

router.delete('/me', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { password } = deleteAccountSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !user.password) {
      await fakeVerifyPassword(password);
      throw new UnauthorizedException('Password is incorrect.');
    }

    const isValid = await verifyPassword(user.password, password);
    if (!isValid) {
      throw new UnauthorizedException('Password is incorrect.');
    }

    const originalEmail = user.email;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'DELETED',
        email: `deleted-${user.id}@deleted.synora.internal`,
        password: null,
      },
    });

    await revokeAllUserTokens(user.id);
    await sendMailBestEffort('account-deleted', () =>
      sendAccountDeletedEmail({ to: originalEmail, name: user.name })
    );

    res.json(createApiResponse({ message: 'Account deleted.' }));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        image: true,
        profile: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User');
    }

    res.json(createApiResponse(user));
  } catch (error) {
    next(error);
  }
});

export default router;
