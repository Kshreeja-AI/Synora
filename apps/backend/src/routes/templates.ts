import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import { prisma } from '@synora/database';
import { createAgent, getAgent, persistAgent } from '../agents/agent-registry';
import { getTemplate, listTemplates } from '../agents/templates';
import {
  deleteWorkspaceTemplate,
  forgetWorkspaceTemplate,
  getWorkspaceTemplate,
  listWorkspaceTemplates,
  persistWorkspaceTemplate,
  saveAsTemplate,
  type WorkspaceTemplate,
} from '../agents/workspace-templates';
import { contributedTemplates } from '../plugins/plugin-registry';
import { createWorkflow, getWorkflow, persistWorkflow } from '../workflows/workflow-registry';

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
    // Three sources, one list: shipped with the platform, contributed by a
    // plugin, and written here. A user choosing a starting point does not
    // care which is which, so they are not segregated — but each carries
    // enough to tell them apart if they look.
    const authored = listWorkspaceTemplates(req.params.workspaceId).filter(
      (t) => !kind || t.kind === kind,
    );
    res.json(createApiResponse([...listTemplates(kind), ...contributed, ...authored]));
  } catch (error) {
    next(error);
  }
});

/**
 * Which of a saved template's tools still exist here. Built-in and plugin
 * templates never name tools at all, so they resolve to nothing granted —
 * which is the correct and deliberate answer, not an oversight.
 */
async function resolveTools(
  authored: WorkspaceTemplate | null,
  workspaceId: string,
): Promise<{ allowedTools: string[]; droppedTools: string[] }> {
  if (!authored || authored.toolIds.length === 0) {
    return { allowedTools: [], droppedTools: [] };
  }
  const alive = await prisma.toolDefinition.findMany({
    where: { workspaceId, id: { in: authored.toolIds } },
    select: { id: true },
  });
  const aliveIds = new Set(alive.map((t) => t.id));
  return {
    allowedTools: authored.toolIds.filter((id) => aliveIds.has(id)),
    droppedTools: authored.toolIds.filter((id) => !aliveIds.has(id)),
  };
}

const instantiateSchema = z.object({
  /** Optional override; the template's own name is the default. */
  name: z.string().min(1).max(200).optional(),
});

router.post(
  '/:workspaceId/agent-templates/:templateId/instantiate',
  async (req: AuthRequest, res, next) => {
    try {
      const authored = getWorkspaceTemplate(req.params.templateId, req.params.workspaceId);
      const template =
        authored ??
        getTemplate(req.params.templateId) ??
        contributedTemplates(req.params.workspaceId).find(
          (t) => t.id === req.params.templateId,
        ) ??
        null;
      if (!template) return next(new NotFoundException('Template'));
      const { name } = instantiateSchema.parse(req.body ?? {});

      // Only a workspace-authored template carries real tool ids, and even
      // then they are re-checked here: a tool can be deleted after the
      // template was saved, and granting a dead id would produce a
      // ready-looking definition that fails on first use. What survives is
      // granted; what did not is REPORTED, never silently dropped.
      const { allowedTools, droppedTools } = await resolveTools(
        authored,
        req.params.workspaceId,
      );

      if (template.kind === 'agent') {
        const agent = createAgent({
          workspaceId: req.params.workspaceId,
          name: name ?? template.name,
          description: template.description,
          instructions: template.instructions,
          allowedTools,
          createdBy: req.userId!,
        });
        await persistAgent(agent.id);
        return res
          .status(201)
          .json(createApiResponse({ kind: 'agent', agent, droppedTools }));
      }

      if (!template.steps || template.steps.length === 0) {
        // A workflow template with no steps could never run. Refusing
        // names the problem; creating an empty workflow would hand
        // someone a thing that looks saved and fails on first use.
        return next(new ValidationException('this workflow template has no steps'));
      }
      const workflow = createWorkflow({
        workspaceId: req.params.workspaceId,
        name: name ?? template.name,
        description: template.description,
        instructions: template.instructions,
        steps: template.steps,
        allowedTools,
        createdBy: req.userId!,
      });
      await persistWorkflow(workflow.id);
      res.status(201).json(createApiResponse({ kind: 'workflow', workflow, droppedTools }));
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

const saveSchema = z.object({
  /** Exactly one of these; a template is a snapshot of one thing. */
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1_000).optional(),
  category: z.enum(['writing', 'research', 'analysis', 'operations', 'code']).optional(),
  outcome: z.string().max(500).optional(),
});

router.post('/:workspaceId/agent-templates', async (req: AuthRequest, res, next) => {
  try {
    const body = saveSchema.parse(req.body ?? {});
    if (!body.agentId === !body.workflowId) {
      return next(
        new ValidationException('name exactly one of agentId or workflowId to save as a template'),
      );
    }

    const source = body.agentId
      ? getAgent(body.agentId, req.params.workspaceId)
      : getWorkflow(body.workflowId!, req.params.workspaceId);
    // Cross-workspace and nonexistent are the same answer, as everywhere.
    if (!source) return next(new NotFoundException(body.agentId ? 'Agent' : 'Workflow'));

    const template = saveAsTemplate({
      workspaceId: req.params.workspaceId,
      authoredBy: req.userId!,
      source,
      name: body.name,
      description: body.description,
      category: body.category,
      outcome: body.outcome,
    });
    await persistWorkspaceTemplate(template.id, req.params.workspaceId);
    res.status(201).json(createApiResponse(template));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('needs a name') || message.includes('exceeds') || message.includes('at most')) {
      return next(new ValidationException(message));
    }
    next(error);
  }
});

router.delete('/:workspaceId/agent-templates/:templateId', async (req: AuthRequest, res, next) => {
  try {
    // Only a workspace's own templates are removable. The built-in
    // catalogue and a plugin's contributions are not this workspace's to
    // delete — a plugin's go when the plugin does.
    const removed = deleteWorkspaceTemplate(req.params.templateId, req.params.workspaceId);
    if (!removed) return next(new NotFoundException('Template'));
    await forgetWorkspaceTemplate(req.params.templateId);
    res.json(createApiResponse({ deleted: true }));
  } catch (error) {
    next(error);
  }
});

export default router;
