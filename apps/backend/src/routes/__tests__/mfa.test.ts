import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import mfaRouter from '../mfa';
import { MFAService } from '../../services/mfa/mfa.service';
import { TOTPService } from '../../services/mfa/totp.service';
import { createApiError, UnauthorizedException } from '@synora/shared';

const prisma = new PrismaClient();

// Helper middleware to simulate authenticated requests
const mockAuth = (req: Request, res: Response, next: NextFunction) => {
  (req as any).userId = 'test-user-123';
  next();
};

// Helper middleware for CSRF (mock)
const mockCsrf = (req: Request, res: Response, next: NextFunction) => {
  next();
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(mockCsrf);
  app.use('/auth/mfa', mockAuth, mfaRouter);

  // Error handling
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof UnauthorizedException) {
      return res.status(401).json(createApiError(err.message));
    }
    res.status(500).json(createApiError(err.message || 'Internal server error'));
  });

  return app;
}

describe('MFA Routes', () => {
  const userId = 'test-user-123';
  let app: express.Application;

  async function cleanupUser() {
    try {
      const mfaMethods = await prisma.mFAMethod.findMany({ where: { userId } });
      for (const method of mfaMethods) {
        await prisma.mFAAttempt.deleteMany({ where: { mfaMethodId: method.id } });
        await prisma.mFARecoveryCode.deleteMany({ where: { mfaMethodId: method.id } });
      }
      await prisma.mFAMethod.deleteMany({ where: { userId } });
      await prisma.mFAChallengeToken.deleteMany({ where: { userId } });
      await prisma.mFASetupToken.deleteMany({ where: { userId } });
    } catch (error) {
      // Ignore
    }
  }

  beforeEach(async () => {
    app = createTestApp();
    await cleanupUser();
  });

  describe('GET /auth/mfa/status', () => {
    it('should return MFA disabled status', async () => {
      const response = await request(app).get('/auth/mfa/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data.mfaEnabled).toBe(false);
    });

    it('should return MFA enabled status with recovery code counts', async () => {
      // Setup MFA first
      const setupResult = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(setupResult.secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      const response = await request(app).get('/auth/mfa/status');

      expect(response.status).toBe(200);
      expect(response.body.data.mfaEnabled).toBe(true);
      expect(response.body.data.type).toBe('TOTP');
      expect(response.body.data.recoveryCodesRemaining).toBe(10);
      expect(response.body.data.recoveryCodesTotal).toBe(10);
    });
  });

  describe('POST /auth/mfa/setup/initiate', () => {
    it('should return setup token and QR code', async () => {
      const response = await request(app).post('/auth/mfa/setup/initiate');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('setupToken');
      expect(response.body.data).toHaveProperty('secret');
      expect(response.body.data).toHaveProperty('qrCode');
      expect(response.body.data).toHaveProperty('expiresAt');

      expect(response.body.data.secret).toHaveLength(32);
      expect(response.body.data.qrCode).toContain('otpauth://totp/');
    });

    it('should reject if already enabled', async () => {
      // Setup MFA first
      const setupResult = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(setupResult.secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      const response = await request(app).post('/auth/mfa/setup/initiate');

      expect(response.status).toBe(409);
    });
  });

  describe('POST /auth/mfa/setup/verify', () => {
    it('should verify code and return recovery codes', async () => {
      // Initiate setup
      const initiateResponse = await request(app).post('/auth/mfa/setup/initiate');
      const { setupToken, secret } = initiateResponse.body.data;
      const code = TOTPService.getCurrentCode(secret);

      // Verify code
      const verifyResponse = await request(app)
        .post('/auth/mfa/setup/verify')
        .send({
          setupToken,
          code,
        });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.data).toHaveProperty('recoveryCodes');
      expect(verifyResponse.body.data.recoveryCodes).toHaveLength(10);

      verifyResponse.body.data.recoveryCodes.forEach((code: string) => {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      });
    });

    it('should reject invalid code', async () => {
      const initiateResponse = await request(app).post('/auth/mfa/setup/initiate');
      const { setupToken } = initiateResponse.body.data;

      const verifyResponse = await request(app)
        .post('/auth/mfa/setup/verify')
        .send({
          setupToken,
          code: '000000',
        });

      expect(verifyResponse.status).toBe(401);
    });

    it('should validate code format', async () => {
      const initiateResponse = await request(app).post('/auth/mfa/setup/initiate');
      const { setupToken } = initiateResponse.body.data;

      const verifyResponse = await request(app)
        .post('/auth/mfa/setup/verify')
        .send({
          setupToken,
          code: 'invalid', // Not 6 digits
        });

      expect(verifyResponse.status).toBe(400);
    });
  });

  describe('POST /auth/mfa/setup/confirm', () => {
    it('should complete MFA setup', async () => {
      // Initiate
      const initiateResponse = await request(app).post('/auth/mfa/setup/initiate');
      const { setupToken, secret } = initiateResponse.body.data;
      const code = TOTPService.getCurrentCode(secret);

      // Verify
      const verifyResponse = await request(app)
        .post('/auth/mfa/setup/verify')
        .send({ setupToken, code });

      const { recoveryCodes } = verifyResponse.body.data;

      // Confirm
      const confirmResponse = await request(app)
        .post('/auth/mfa/setup/confirm')
        .send({
          setupToken,
          recoveryCodes,
          recoveryCodesSaved: true,
        });

      expect(confirmResponse.status).toBe(200);
      expect(confirmResponse.body.data.mfaEnabled).toBe(true);
    });

    it('should reject without recovery codes saved flag', async () => {
      const initiateResponse = await request(app).post('/auth/mfa/setup/initiate');
      const { setupToken, secret } = initiateResponse.body.data;
      const code = TOTPService.getCurrentCode(secret);

      const verifyResponse = await request(app)
        .post('/auth/mfa/setup/verify')
        .send({ setupToken, code });

      const { recoveryCodes } = verifyResponse.body.data;

      const confirmResponse = await request(app)
        .post('/auth/mfa/setup/confirm')
        .send({
          setupToken,
          recoveryCodes,
          recoveryCodesSaved: false,
        });

      expect(confirmResponse.status).toBe(401);
    });

    it('should reject without recovery codes in body', async () => {
      const initiateResponse = await request(app).post('/auth/mfa/setup/initiate');
      const { setupToken, secret } = initiateResponse.body.data;
      const code = TOTPService.getCurrentCode(secret);

      const verifyResponse = await request(app)
        .post('/auth/mfa/setup/verify')
        .send({ setupToken, code });

      const confirmResponse = await request(app)
        .post('/auth/mfa/setup/confirm')
        .send({
          setupToken,
          recoveryCodes: [], // Empty
          recoveryCodesSaved: true,
        });

      expect(confirmResponse.status).toBe(401);
    });
  });

  describe('GET /auth/mfa/recovery-codes', () => {
    it('should return empty for user without MFA', async () => {
      const response = await request(app).get('/auth/mfa/recovery-codes');

      expect(response.status).toBe(200);
      expect(response.body.data.codes).toHaveLength(0);
    });

    it('should return masked recovery codes', async () => {
      // Setup MFA first
      const setupResult = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(setupResult.secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      const response = await request(app).get('/auth/mfa/recovery-codes');

      expect(response.status).toBe(200);
      expect(response.body.data.codes).toHaveLength(10);

      response.body.data.codes.forEach((code: any) => {
        expect(code).toHaveProperty('prefix');
        expect(code).toHaveProperty('usedAt');
        expect(code.prefix).toHaveLength(8);
      });
    });
  });

  describe('POST /auth/mfa/disable', () => {
    it('should disable MFA', async () => {
      // Setup MFA first
      const setupResult = await MFAService.startSetup(userId);
      const code = TOTPService.getCurrentCode(setupResult.secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      const response = await request(app)
        .post('/auth/mfa/disable')
        .send({ password: 'test-password' });

      expect(response.status).toBe(200);
      expect(response.body.data.mfaEnabled).toBe(false);
    });

    it('should require password', async () => {
      const response = await request(app).post('/auth/mfa/disable').send({});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/mfa/verify', () => {
    it('should verify TOTP code', async () => {
      // Setup MFA first
      const setupResult = await MFAService.startSetup(userId);
      const secret = setupResult.secret;
      const code = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Verify challenge code
      const challengeCode = TOTPService.getCurrentCode(secret);
      const response = await request(app)
        .post('/auth/mfa/verify')
        .send({
          mfaChallengeToken,
          code: challengeCode,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.mfaVerified).toBe(true);
    });

    it('should reject invalid code', async () => {
      // Setup MFA
      const setupResult = await MFAService.startSetup(userId);
      const secret = setupResult.secret;
      const code = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      const response = await request(app)
        .post('/auth/mfa/verify')
        .send({
          mfaChallengeToken,
          code: '000000',
        });

      expect(response.status).toBe(401);
    });

    it('should verify recovery code', async () => {
      // Setup MFA
      const setupResult = await MFAService.startSetup(userId);
      const secret = setupResult.secret;
      const code = TOTPService.getCurrentCode(secret);
      const verifyResult = await MFAService.verifySetupCode(userId, setupResult.setupToken, code);
      const recoveryCode = verifyResult.recoveryCodes[0];
      await MFAService.confirmSetup(userId, setupResult.setupToken, verifyResult.recoveryCodes);

      // Generate challenge
      const { mfaChallengeToken } = await MFAService.generateChallenge(
        userId,
        'session-123',
        '127.0.0.1',
        'Mozilla'
      );

      // Verify recovery code
      const response = await request(app)
        .post('/auth/mfa/verify')
        .send({
          mfaChallengeToken,
          recoveryCode,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.mfaVerified).toBe(true);
      expect(response.body.data.warning).toContain('Recovery code used');
    });

    it('should require either code or recovery code', async () => {
      const response = await request(app).post('/auth/mfa/verify').send({
        mfaChallengeToken: 'token123',
      });

      expect(response.status).toBe(401);
    });
  });
});
