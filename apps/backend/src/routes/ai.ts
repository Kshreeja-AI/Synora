import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createApiResponse } from '@synora/shared';
import { generateText } from '../ai';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { aiGenerationLimiter } from '../middleware/resourceRateLimit.js';

const router: Router = Router();

const generateTextRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  mode: z.enum(['text', 'code']).optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().min(1).max(100000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().optional(),
});

router.post('/generate', authMiddleware, aiGenerationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = generateTextRequestSchema.parse(req.body);

    const result = await generateText({
      prompt: body.prompt,
      mode: body.mode,
      model: body.model,
      maxTokens: body.maxTokens,
      temperature: body.temperature,
      systemPrompt: body.systemPrompt,
    });

    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

export default router;
