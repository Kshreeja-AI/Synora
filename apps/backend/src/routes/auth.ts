import { Router } from 'express';
import { z } from 'zod';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { prisma } from '@synora/database';
import { createApiResponse, ValidationException } from '@synora/shared';
import { secretsManager } from '../secrets';
import { getConfig } from '../config';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  fakeVerifyPassword,
} from '../services/password.service';

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

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationException('Email already registered');
    }

    const hashedPassword = await hashPassword(password);

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
      // Spend the same verification time a real account would, so response
      // timing cannot distinguish a registered email from an unregistered
      // one. The message is identical to the wrong-password case below.
      await fakeVerifyPassword(password);
      throw new ValidationException('Invalid email or password');
    }

    const isPasswordValid = await verifyPassword(user.password, password);
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

    // Transparent migration: a correct password against a legacy bcrypt
    // hash (or an Argon2 hash with outdated parameters) is re-hashed with
    // the current Argon2id settings and persisted here. No user-visible
    // change, no forced reset — every successful login gradually migrates
    // the stored hash population off bcrypt.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(needsRehash(user.password) ? { password: await hashPassword(password) } : {}),
      },
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
