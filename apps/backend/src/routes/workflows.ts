import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import {
  archiveWorkflow,
  createWorkflow,
  getWorkflow,
  getWorkflowHistory,
  listWorkflows,
  persistWorkflow,
  updateWorkflow,
} from '../workflows/workflow-registry';
import { startWorkflowRun } from '../workflows/workflow-engine';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  persistSchedule,
  setScheduleEnabled,
} from '../workflows/schedule';
import { persistRun } from '../agents/run-engine';
import { meterRun } from '../agents/metering';
import { TERMINAL_RUN_STATES } from '../agents/types';
import { resolveAgentRuntime } from '../agents/runtime';

/**
 * The workflow HTTP surface.
 *
 * Mounted alongside agents and deliberately shaped the same way, because
 * from a caller's point of view the difference between the two is what
 * decides the steps, not how you talk to it.
 *
 * ONE THING IS GENUINELY DIFFERENT, and it is worth stating. Starting a
 * workflow run does not need a planner — the steps are already written —
 * so the runtime is resolved only for the tool runner and the text
 * generator. The response therefore reports `authored` as the plan origin
 * regardless of whether an AI provider is configured, because no provider
 * was consulted about what to do. Reporting `local` here would be false in
 * the other direction: nothing was improvised, deterministically or
 * otherwise.
 */

const router: ExpressRouter = Router({ mergeParams: true });

const stepSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['generate', 'tool']),
  description: z.string().min(1).max(500),
  toolId: z.string().min(1).max(200).optional(),
  input: z.string().max(20_000),
  mutating: z.boolean().optional(),
  dependsOn: z.array(z.string()).optional(),
});

const limitsSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().positive().optional(),
    maxDurationMs: z.number().int().positive().optional(),
    maxRetriesPerStep: z.number().int().min(0).optional(),
  })
  .optional();

const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(20_000).optional(),
  steps: z.array(stepSchema).min(1),
  allowedTools: z.array(z.string()).optional(),
  approvalPolicy: z.enum(['nothing', 'mutations', 'everything']).optional(),
  limits: limitsSchema,
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(20_000).optional(),
  steps: z.array(stepSchema).min(1).optional(),
  allowedTools: z.array(z.string()).optional(),
  approvalPolicy: z.enum(['nothing', 'mutations', 'everything']).optional(),
  limits: limitsSchema,
});

const startSchema = z.object({ task: z.string().max(10_000).default('') });

function toHttpError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'workflow not found' || message === 'agent not found') {
    return new NotFoundException('Workflow');
  }
  if (message === 'schedule not found') return new NotFoundException('Schedule');
  if (
    message.includes('schedule kind') ||
    message.includes('time of day') ||
    message.includes('specify an interval') ||
    message.includes('atMinuteUtc') ||
    message.includes('intervalMs')
  ) {
    return new ValidationException(message);
  }
  if (
    message.includes('cannot run as written') ||
    message.includes('archived') ||
    message.includes('needs a name') ||
    message.startsWith('limit ')
  ) {
    // An unrunnable authored sequence is a validation failure of the thing
    // the caller sent, and the message names exactly which step is wrong.
    return new ValidationException(message);
  }
  return err;
}

router.use('/:workspaceId/workflows', authMiddleware, requireWorkspaceAccess());
// Schedules live at their own path, so they need their own guard. A
// `router.use` only covers the prefix it names — a second resource mounted
// on the same router is NOT protected by the first one's middleware, which
// is exactly how an endpoint ends up unauthenticated by accident.
router.use('/:workspaceId/schedules', authMiddleware, requireWorkspaceAccess());

router.get('/:workspaceId/workflows', async (req: AuthRequest, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    res.json(createApiResponse(listWorkflows(req.params.workspaceId, { includeArchived })));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/workflows', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const workflow = createWorkflow({
      ...body,
      workspaceId: req.params.workspaceId,
      createdBy: req.userId!,
    });
    await persistWorkflow(workflow.id);
    res.status(201).json(createApiResponse(workflow));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.get('/:workspaceId/workflows/:workflowId', async (req: AuthRequest, res, next) => {
  try {
    const workflow = getWorkflow(req.params.workflowId, req.params.workspaceId);
    if (!workflow) return next(new NotFoundException('Workflow'));
    res.json(createApiResponse(workflow));
  } catch (error) {
    next(error);
  }
});

router.patch('/:workspaceId/workflows/:workflowId', async (req: AuthRequest, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const next_ = updateWorkflow(req.params.workflowId, req.params.workspaceId, body, req.userId!);
    await persistWorkflow(next_.id);
    res.json(createApiResponse(next_));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.get('/:workspaceId/workflows/:workflowId/history', async (req: AuthRequest, res, next) => {
  try {
    const workflow = getWorkflow(req.params.workflowId, req.params.workspaceId);
    if (!workflow) return next(new NotFoundException('Workflow'));
    res.json(createApiResponse(getWorkflowHistory(workflow.lineageId, req.params.workspaceId)));
  } catch (error) {
    next(error);
  }
});

router.delete('/:workspaceId/workflows/:workflowId', async (req: AuthRequest, res, next) => {
  try {
    const archived = archiveWorkflow(req.params.workflowId, req.params.workspaceId);
    await persistWorkflow(archived.id);
    res.json(createApiResponse(archived));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.post('/:workspaceId/workflows/:workflowId/runs', async (req: AuthRequest, res, next) => {
  try {
    const { task } = startSchema.parse(req.body ?? {});
    // Resolved for the tool runner and text generator only — the planner
    // this returns is discarded, because the steps are already written.
    const runtime = await resolveAgentRuntime(req.userId!);
    const run = await startWorkflowRun(
      {
        workflowId: req.params.workflowId,
        workspaceId: req.params.workspaceId,
        requestedBy: req.userId!,
        task,
      },
      {
        toolRunner: runtime.deps.toolRunner,
        generate: runtime.deps.generate,
      },
    );
    await persistRun(run.id);
    if (TERMINAL_RUN_STATES.includes(run.state)) {
      await meterRun({ run, capability: 'workflow-run' });
    }
    res.status(201).json(
      createApiResponse({
        run,
        runtime: {
          mode: 'authored',
          notice:
            'AUTHORED: this run executed the steps written into the workflow, in order, with nothing improvised. It is repeatable by design.',
          planOrigin: run.plan?.origin,
        },
      }),
    );
  } catch (error) {
    next(toHttpError(error));
  }
});

// --- Schedules -----------------------------------------------------------
//
// A schedule starts runs as the person who CREATED it, never with ambient
// authority — see scheduler-runner.ts. Creating one is therefore an act of
// lending your own permissions to a clock, which is why it is scoped and
// audited like everything else.

const scheduleSchema = z.object({
  kind: z.enum(['interval', 'daily']),
  intervalMs: z.number().int().positive().optional(),
  atMinuteUtc: z.number().int().min(0).max(1439).optional(),
});

router.get('/:workspaceId/workflows/:workflowId/schedules', async (req: AuthRequest, res, next) => {
  try {
    const workflow = getWorkflow(req.params.workflowId, req.params.workspaceId);
    if (!workflow) return next(new NotFoundException('Workflow'));
    res.json(createApiResponse(listSchedules(req.params.workspaceId, workflow.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/workflows/:workflowId/schedules', async (req: AuthRequest, res, next) => {
  try {
    const body = scheduleSchema.parse(req.body);
    // Resolved first so a schedule can never point at a workflow the
    // caller cannot see.
    const workflow = getWorkflow(req.params.workflowId, req.params.workspaceId);
    if (!workflow) return next(new NotFoundException('Workflow'));
    if (workflow.archived) {
      return next(new ValidationException('an archived workflow cannot be scheduled'));
    }

    const schedule = createSchedule({
      ...body,
      workspaceId: req.params.workspaceId,
      workflowId: workflow.id,
      createdBy: req.userId!,
    });
    await persistSchedule(schedule.id);
    res.status(201).json(createApiResponse(schedule));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.patch('/:workspaceId/schedules/:scheduleId', async (req: AuthRequest, res, next) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const schedule = setScheduleEnabled(req.params.scheduleId, req.params.workspaceId, enabled);
    await persistSchedule(schedule.id);
    res.json(createApiResponse(schedule));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.delete('/:workspaceId/schedules/:scheduleId', async (req: AuthRequest, res, next) => {
  try {
    const removed = deleteSchedule(req.params.scheduleId, req.params.workspaceId);
    if (!removed) return next(new NotFoundException('Schedule'));
    res.json(createApiResponse({ deleted: true }));
  } catch (error) {
    next(toHttpError(error));
  }
});

export default router;
