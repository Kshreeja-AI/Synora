import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  },
  handler: (_req, res) => {
    logger.warn('Login rate limit exceeded', {
      ip: _req.ip,
      email: _req.body?.email,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many login attempts. Please try again after 15 minutes.',
      },
    });
  },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many registration attempts, please try again after 1 hour.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  },
  handler: (_req, res) => {
    logger.warn('Registration rate limit exceeded', {
      ip: _req.ip,
      email: _req.body?.email,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many registration attempts. Please try again after 1 hour.',
      },
    });
  },
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many password reset requests, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  },
  handler: (_req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: _req.ip,
      email: _req.body?.email,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many password reset requests. Please try again after 15 minutes.',
      },
    });
  },
});

export const refreshTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many token refresh attempts.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  },
  handler: (_req, res) => {
    logger.warn('Token refresh rate limit exceeded', {
      ip: _req.ip,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many token refresh attempts.',
      },
    });
  },
});
