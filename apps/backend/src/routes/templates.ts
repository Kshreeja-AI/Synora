import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import { createAgent, persistAgent } from '../agents/agent-registry';
import { getTemplate, listTemplates } from '../agents/templates';
import { contributedTemplates } from '../plugins/plugin-registry';
import { createWorkflow, persistWorkflow } from '../workflows/workflow-registry';

/**
 * Templates: starting configurations, and turning one into a real thing.
 *
 * INSTANTIATING PRODUCES A GENUINE AGENT OR WORKFLOW — the same registry,
 * the same validation, the same immutable versioning, the same fail-closed
 * defaults. A template is not a special kind of object that behaves
 * differently afterwards; it is a shortcut past the blank page, and once
 * used it leaves nothing behind. That is why there is no "template link"
 * on the created agent: it would imply a relationship that does not exist
 * and cannot be maintained.
 *
 * Every template creates something GENERATE-ONLY. Tool ids are
 * per-workspace, so a template that named one would produce a definition
 * pointing at a tool that may not exist here — ready-looking and broken.
 * The template's `suggestedTools` are plain capability names for a human
 * to wire up afterwards, never ids the system pretends are connected.
 *
 * THE PATH IS `agent-templates`, NOT `templates`, because
 * `conversationTemplates.ts` already owns `/:workspaceId/templates` on the
 * same `/api/workspaces` mount. Two routers claiming one path means the
 * earlier mount silently wins and the later one is unreachable — the same
 * shadowing that once hid `/agents/runs` behind `/agents/:agentId`. The
 * distinct name also keeps the two ideas separate for a reader: a
 * conversation template starts a chat, these start an agent or workflow.
 */

const router: ExpressRouter = Router({ mergeParams: true });

router.use('/:workspaceId/agent-templates', authMiddleware, requireWorkspaceAccess());

router.get('/:workspaceId/agent-templates', async (req: AuthRequest, res, next) => {
  try {
    const kind = z.enum(['agent', 'workflow']).optional().parse(req.query.kind);
    // Plugin contributions are checked at READ time, not cached from
    // install, so disabling a plugin removes its templates immediately
    // rather than at some later refresh.
    const contributed = contributedTemplates(req.params.workspaceId).filter(
      (t) => !kind || t.kind === kind,
    );
    res.json(createApiResponse([...listTemplates(kind), ...contributed]));
  } catch (error) {
    next(error);
  }
});

const instantiateSchema = z.object({
  /** Optional override; the template's own name is the default. */
  name: z.string().min(1).max(200).optional(),
});

router.post(
  '/:workspaceId/agent-templates/:templateId/instantiate',
  async (req: AuthRequest, res, next) => {
    try {
      const template =
        getTemplate(req.params.templateId) ??
        contributedTemplates(req.params.workspaceId).find(
          (t) => t.id === req.params.templateId,
        ) ??
        null;
      if (!template) return next(new NotFoundException('Template'));
      const { name } = instantiateSchema.parse(req.body ?? {});

      if (template.kind === 'agent') {
        const agent = createAgent({
          workspaceId: req.params.workspaceId,
          name: name ?? template.name,
          description: template.description,
          instructions: template.instructions,
          // Left empty deliberately — see the file comment. The caller
          // adds tools afterwards, having seen which exist here.
          allowedTools: [],
          createdBy: req.userId!,
        });
        await persistAgent(agent.id);
        return res.status(201).json(createApiResponse({ kind: 'agent', agent }));
      }

      const workflow = createWorkflow({
        workspaceId: req.params.workspaceId,
        name: name ?? template.name,
        description: template.description,
        instructions: template.instructions,
        steps: template.steps,
        allowedTools: [],
        createdBy: req.userId!,
      });
      await persistWorkflow(workflow.id);
      res.status(201).json(createApiResponse({ kind: 'workflow', workflow }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A template that could not produce a runnable definition is a bug
      // in the template, not in the request — but it still must surface
      // as the store's own message rather than a generic failure.
      if (message.includes('needs a name') || message.includes('cannot run as written')) {
        return next(new ValidationException(message));
      }
      next(error);
    }
  },
);

export default router;
