import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import express, { json } from 'express';
import * as jwt from 'jsonwebtoken';
import aiRouter from '../ai';
import { errorHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { initConfig } from '../../config';

// vi.mock() factories are hoisted above the rest of the module, so the
// mock function itself must be created inside vi.hoisted() — referencing a
// plain `let` here would be accessed before its initialization.
const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}));

// Mock the generateText function
vi.mock('../../ai', async () => {
  const actual = await vi.importActual('../../ai');
  return {
    ...actual,
    generateText: mockGenerateText,
  };
});

describe('AI Routes', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    token = jwt.sign({ userId: 'test-user-id', workspaceId: 'test-workspace-id' }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    });
    app = express();
    app.use(json());
    app.use(authMiddleware);
    app.use('/api', aiRouter);

    // The real error middleware, so ZodError -> 400 VALIDATION_ERROR is
    // exercised exactly as it is in production (see middleware/errorHandler.ts).
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/generate', () => {
    it('generates text successfully', async () => {
      const mockResult = {
        text: 'Generated response',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 10, outputTokens: 20 },
        finishReason: 'end_turn',
      };

      mockGenerateText.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Write hello world',
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockResult);
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Write hello world',
        })
      );
    });

    it('accepts all optional parameters', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Result',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { inputTokens: 5, outputTokens: 10 },
        finishReason: 'stop',
      });

      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Write code',
          mode: 'code',
          model: 'gpt-4o-mini',
          maxTokens: 2048,
          temperature: 0.7,
          systemPrompt: 'You are a code expert',
        });

      expect(response.status).toBe(200);
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Write code',
          mode: 'code',
          model: 'gpt-4o-mini',
          maxTokens: 2048,
          temperature: 0.7,
          systemPrompt: 'You are a code expert',
        })
      );
    });

    it('rejects request without prompt', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          model: 'claude-sonnet-5',
        });

      expect(response.status).toBe(400);
    });

    it('rejects empty prompt', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: '',
        });

      expect(response.status).toBe(400);
    });

    it('rejects invalid mode', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Test',
          mode: 'invalid-mode',
        });

      expect(response.status).toBe(400);
    });

    it('rejects invalid maxTokens (non-integer)', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Test',
          maxTokens: 2048.5,
        });

      expect(response.status).toBe(400);
    });

    it('rejects maxTokens out of range', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Test',
          maxTokens: 1000000,
        });

      expect(response.status).toBe(400);
    });

    it('rejects invalid temperature', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Test',
          temperature: 3.0,
        });

      expect(response.status).toBe(400);
    });

    it('handles provider errors', async () => {
      mockGenerateText.mockRejectedValue(
        new Error('No provider configured')
      );

      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Test',
        });

      expect(response.status).toBe(500);
    });

    it('handles API call errors', async () => {
      mockGenerateText.mockRejectedValue(
        new Error('Rate limit exceeded')
      );

      const response = await request(app)
        .post('/api/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          prompt: 'Test',
        });

      expect(response.status).toBe(500);
    });
  });
});
