import { Router } from 'express';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { createApiResponse, ValidationException } from '@synora/shared';
import { secretsManager } from '../secrets';
import { getConfig } from '../config';

const router: Router = Router();
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

router.post('/register', async (req, res, next) => {
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

    const jwtSecret = await secretsManager.get('JWT_SECRET', 'backend:auth-route');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: getConfig().auth.jwtExpiry as SignOptions['expiresIn'],
      }
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

router.post('/login', async (req, res, next) => {
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

    const jwtSecret = await secretsManager.get('JWT_SECRET', 'backend:auth-route');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: getConfig().auth.jwtExpiry as SignOptions['expiresIn'],
      }
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

router.post('/logout', (req, res) => {
  res.json(createApiResponse({ message: 'Logged out successfully' }));
});

export default router;
