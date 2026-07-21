import { Router } from 'express';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { createApiResponse, createApiError, ValidationException } from '@synora/shared';
import { csrfProtectionMiddleware, generateCsrfToken } from '../middleware/csrfProtection';

const router = Router();
const prisma = new PrismaClient();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Get CSRF token (no authentication required)
router.get('/csrf', generateCsrfToken);

// Protected routes with CSRF validation
router.post('/register', csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationException('Email already registered');
    }

    const hashedPassword = await bcryptjs.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || '',
      { expiresIn: process.env.JWT_EXPIRY || '15m' }
    );

    res.status(201).json(
      createApiResponse({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post('/login', csrfProtectionMiddleware, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      throw new ValidationException('Invalid email or password');
    }

    const isPasswordValid = await bcryptjs.compare(password, user.password);
    if (!isPasswordValid) {
      throw new ValidationException('Invalid email or password');
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || '',
      { expiresIn: process.env.JWT_EXPIRY || '15m' }
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    res.json(
      createApiResponse({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post('/logout', csrfProtectionMiddleware, (_req, res) => {
  res.json(createApiResponse({ message: 'Logged out successfully' }));
});

export default router;
