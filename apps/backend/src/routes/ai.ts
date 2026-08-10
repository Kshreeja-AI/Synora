import { Router, type Response, type NextFunction } from 'express';
import { requireMembership } from '../services/checks';
import { z } from 'zod';
import { createApiResponse, TooManyRequestsException } from '@synora/shared';
import { AIRateLimitedError } from '../ai';
import { instrumentedGenerate } from '../ai/instrumentedGenerate';
import { AiBudgetExceededError } from '../ai/spend-guard';
import { listAvailableModels } from '../ai/models';
import { checkProviderReadiness } from '../ai/verification';
import { getTextProviderMetrics } from '../ai/textResilience';
import { declareAiPath } from '../eos/instrumentation';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { aiGenerationLimiter } from '../middleware/resourceRateLimit.js';

/**
 * Its own promptId, never 'chat.generate': this is a raw API entry point
 * any client or integration can call directly, with a shape and calling
 * context Synora cannot infer — pooling it into the interactive chat
 * baseline would be a guess dressed up as a measurement.
 */
declareAiPath('api.generate.direct');

const router: Router = Router();

/**
 * GET /api/ai/models — model catalog with live provider availability.
 *
 * The frontend model picker calls this to render the full grouped list. Every
 * provider stays in the response even when unconfigured (with `configured:
 * false`) so the picker can render it greyed-out with a "needs API key" hint
 * — much clearer than silently omitting providers a user might be expecting.
 */
router.get('/models', authMiddleware, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const catalog = await listAvailableModels();
    return res.json(createApiResponse({ providers: catalog }));
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/ai/provider-readiness — "if I add credentials, what actually works?"
 *
 * `/models` answers whether a key is PRESENT. This answers whether that key
 * is ACCEPTED, by making the cheapest authenticated call each provider
 * offers. The two are different questions and a typo'd or expired key
 * answers the first one "yes".
 *
 * Authenticated rather than public: the response enumerates which providers
 * this deployment has credentials for, which is infrastructure information
 * about the operator, not about any workspace.
 */
router.get(
  '/provider-readiness',
  authMiddleware,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return res.json(createApiResponse({ providers: await checkProviderReadiness() }));
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/ai/provider-metrics — what has actually been happening to
 * provider calls in this process.
 *
 * Reports refusals SEPARATELY from failures. "80% of calls failed" and "80%
 * of calls were never sent because our own rate limit refused them" look
 * identical in a plain error count, lead to opposite diagnoses, and cost
 * very different amounts of money.
 *
 * Authenticated for the same reason as `/provider-readiness`: this is
 * infrastructure information about the deployment, not about a workspace.
 * Counts are per-process and reset on restart — stated here so nobody reads
 * them as durable billing figures.
 */
router.get(
  '/provider-metrics',
  authMiddleware,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return res.json(
        createApiResponse({
          providers: getTextProviderMetrics(),
          scope: 'this process since it started; resets on restart',
        })
      );
    } catch (err) {
      return next(err);
    }
  }
);

const generateTextRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  mode: z.enum(['text', 'code']).optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().min(1).max(100000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().optional(),
  /**
   * Which workspace to bill this to. Optional for backward compatibility —
   * this endpoint has never been workspace-scoped — but supplying it is
   * what makes a per-workspace spend cap bind, so clients should.
   * Membership is verified below; a caller cannot bill a workspace they
   * are not in.
   */
  workspaceId: z.string().min(1).optional(),
});

router.post('/generate', authMiddleware, aiGenerationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = generateTextRequestSchema.parse(req.body);

    // A client-supplied workspace id decides whose budget pays, so it is
    // VERIFIED, never trusted: without this check any authenticated user
    // could charge their generation to someone else's workspace — or, more
    // subtly, discover which workspace ids exist by watching which ones
    // were accepted. `requireMembership` answers 404 for a non-member, so
    // a stranger's id is indistinguishable from one that does not exist.
    if (body.workspaceId) {
      await requireMembership(req.userId!, body.workspaceId);
    }

    const result = await instrumentedGenerate(
      'api.generate.direct',
      {
        prompt: body.prompt,
        mode: body.mode,
        model: body.model,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        systemPrompt: body.systemPrompt,
      },
      // The user is ALWAYS passed, workspace only when supplied and
      // verified. Previously neither was, so this — the most directly
      // exposed generation endpoint in the product — was bound by the
      // global cap alone and contributed to no workspace's ledger at all.
      { userId: req.userId!, ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}) }
    );

    res.json(createApiResponse(result));
  } catch (error) {
    // Synora's own outbound pacing refused the call before it was sent —
    // a 429 with the same envelope the inbound limiters use, so clients
    // need exactly one back-off handler. Distinct from a vendor 429, which
    // surfaces as a provider error after a real call.
    // A spend-cap refusal: policy, not malfunction. Same 429 envelope as
    // the pacing refusal above, and the message already names the limit and
    // when it resets — composed server-side by the guard, rendered verbatim.
    if (error instanceof AiBudgetExceededError) {
      next(new TooManyRequestsException(error.message));
      return;
    }
    if (error instanceof AIRateLimitedError) {
      next(new TooManyRequestsException(error.message));
      return;
    }
    next(error);
  }
});

export default router;
