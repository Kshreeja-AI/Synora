import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { prisma } from '@synora/database';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import {
  archiveAgent,
  createAgent,
  getAgent,
  getAgentHistory,
  listAgents,
  persistAgent,
  updateAgent,
} from '../agents/agent-registry';
import {
  approveStep,
  cancelRun,
  getRun,
  listRuns,
  persistRun,
  rejectStep,
  startRun,
} from '../agents/run-engine';
import { resolveAgentRuntime, resolveAnyDefinition } from '../agents/runtime';
import { previewAgentPlan } from '../agents/plan-preview';
import { checkPlannedSteps, type PlannedStepCheck } from '../agents/step-checks';
import { canRecall, canRecord, recallForTask, recordRunOutcome, withRecalledContext } from '../agents/memory';
import { assertRunBudget, BudgetExceededError, meterRun } from '../agents/metering';
import { TERMINAL_RUN_STATES } from '../agents/types';
import type { AgentRun } from '../agents/types';

/**
 * The agent HTTP surface.
 *
 * WHY THIS EXISTS. The registry, run engine and durable store were built,
 * tested, and completely unreachable: no route mounted them, so no human
 * could create an agent or start a run. This file is the whole distance
 * between "works in tests" and "a person can use it".
 *
 * FOUR THINGS ARE DELIBERATE HERE:
 *
 * 1. Workspace scoping is the middleware's job AND the module's job. Every
 *    handler passes workspaceId into the registry/engine lookup rather than
 *    trusting that the membership check upstream was enough. Two layers,
 *    not one — the same discipline the tool runner applies.
 *
 * 2. Not-found beats forbidden. An agent in another workspace is answered
 *    identically to one that does not exist, so the API never confirms the
 *    existence of something the caller may not see.
 *
 * 3. Every response carries the runtime notice. A run planned by the
 *    deterministic local planner is materially different from one planned
 *    by a model, and the caller is told which without having to ask. A UI
 *    cannot accidentally render local scaffolding as intelligence, because
 *    the label arrives with the data.
 *
 * 4. Durability is part of the request, not a background hope. Definitions
 *    and runs are written through to the store before the response is sent,
 *    so a 201 means "this survives a restart" rather than "this exists
 *    until the process dies".
 */

const router: ExpressRouter = Router({ mergeParams: true });

const limitsSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().positive().optional(),
    maxDurationMs: z.number().int().positive().optional(),
    // Zero is a legitimate policy — "never retry" — and is not lumped in
    // with the budgets above, where zero would make every run unrunnable
    // while looking configured.
    maxRetriesPerStep: z.number().int().min(0).optional(),
  })
  .optional();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  instructions: z.string().min(1).max(20_000),
  allowedTools: z.array(z.string()).optional(),
  approvalPolicy: z.enum(['nothing', 'mutations', 'everything']).optional(),
  memoryAccess: z.enum(['none', 'recall', 'record', 'both']).optional(),
  limits: limitsSchema,
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  instructions: z.string().min(1).max(20_000).optional(),
  allowedTools: z.array(z.string()).optional(),
  approvalPolicy: z.enum(['nothing', 'mutations', 'everything']).optional(),
  memoryAccess: z.enum(['none', 'recall', 'record', 'both']).optional(),
  limits: limitsSchema,
});

const startRunSchema = z.object({
  task: z.string().min(1).max(10_000),
  projectId: z.string().min(1).optional(),
});

const rejectSchema = z.object({
  reason: z.string().max(2000).optional(),
});

/**
 * Translates the domain layer's plain errors into HTTP. The engine and
 * registry throw Errors deliberately — they are a library and must stay
 * usable without Express — so the mapping lives here, at the boundary.
 */
function toHttpError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof BudgetExceededError) return new ValidationException(message);
  if (message === 'agent not found' || message === 'run not found') {
    return new NotFoundException(message === 'run not found' ? 'Run' : 'Agent');
  }
  if (
    message.includes('archived') ||
    message.includes('needs a task') ||
    message.includes('needs a name') ||
    message.includes('needs instructions') ||
    message.includes('not awaiting approval') ||
    message.startsWith('limit ')
  ) {
    return new ValidationException(message);
  }
  return err;
}

router.use('/:workspaceId/agents', authMiddleware, requireWorkspaceAccess());

// --- Definitions: collection ---------------------------------------------

router.get('/:workspaceId/agents', async (req: AuthRequest, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    res.json(createApiResponse(listAgents(req.params.workspaceId, { includeArchived })));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/agents', async (req: AuthRequest, res, next) => {
  try {
    const body = createAgentSchema.parse(req.body);
    const agent = createAgent({
      ...body,
      workspaceId: req.params.workspaceId,
      createdBy: req.userId!,
    });
    // Written through before the 201, so the status code means durable.
    await persistAgent(agent.id);
    res.status(201).json(createApiResponse(agent));
  } catch (error) {
    next(toHttpError(error));
  }
});

// --- Runs ----------------------------------------------------------------
//
// ORDER IS LOAD-BEARING. These are declared BEFORE `/agents/:agentId`
// because Express matches in declaration order, and `/agents/runs` would
// otherwise be swallowed by the parameterised route with agentId="runs".
// The shadowing is safe in the other direction too: agent ids are minted as
// `agent_<uuid>`, so no real agent can ever be named "runs".

/**
 * The run payload always travels with the label describing what produced
 * it. Bundling them makes the honest thing the default: there is no shape
 * of this response that carries a run without its provenance.
 */
function runResponse(run: AgentRun, runtime: { mode: string; provider?: string; notice: string }) {
  return {
    run,
    runtime: {
      mode: runtime.mode,
      provider: runtime.provider,
      notice: runtime.notice,
      planOrigin: run.plan?.origin,
    },
  };
}

/**
 * Runs store the requester's id; the read surfaces resolve it to a name
 * in one batched lookup. WHO asked for a run is part of the context a
 * decision needs — a person approving a paused step is unblocking a
 * specific colleague, not an anonymous id. The in-memory run is never
 * mutated; the name is attached to the serialized copy only.
 */
async function withRequesterNames(
  runList: AgentRun[],
): Promise<(AgentRun & { requestedByName: string | null })[]> {
  const ids = [...new Set(runList.map((run) => run.requestedBy))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return runList.map((run) => ({
    ...run,
    requestedByName: nameById.get(run.requestedBy) ?? null,
  }));
}

router.get('/:workspaceId/agents/runs', async (req: AuthRequest, res, next) => {
  try {
    const agentLineageId =
      typeof req.query.lineageId === 'string' ? req.query.lineageId : undefined;
    const enriched = await withRequesterNames(
      listRuns(req.params.workspaceId, { agentLineageId }),
    );
    res.json(createApiResponse(enriched));
  } catch (error) {
    next(error);
  }
});

router.get('/:workspaceId/agents/runs/:runId', async (req: AuthRequest, res, next) => {
  try {
    const run = getRun(req.params.runId, req.params.workspaceId);
    if (!run) return next(new NotFoundException('Run'));
    const [enriched] = await withRequesterNames([run]);

    // A paused run is usually decided by someone other than whoever
    // started it, and that person arrives with less context, not more.
    // The consequences of the exact step they are being asked to approve
    // are computed here with the SAME shared checker the previews use —
    // so an approver sees what a previewer would have seen, rather than
    // being asked to say yes to a step id and a one-line reason.
    let pendingStepFacts: PlannedStepCheck | null = null;
    const pendingStep = run.pendingApproval
      ? run.steps.find((record) => record.step.id === run.pendingApproval?.stepId)?.step
      : undefined;
    if (pendingStep) {
      const agent = resolveAnyDefinition(run.agentId, run.workspaceId);
      const [check] = await checkPlannedSteps({
        steps: [pendingStep],
        workspaceId: run.workspaceId,
        requestedBy: req.userId!,
        approvalPolicy: agent?.approvalPolicy ?? 'everything',
      });
      pendingStepFacts = check ?? null;
    }

    res.json(createApiResponse({ ...enriched, pendingStepFacts }));
  } catch (error) {
    next(error);
  }
});

/**
 * Approving a parked step resumes execution, so this returns the run in
 * whatever state it reached next — possibly parked again at a later step.
 * The approver is recorded on the step; there is no anonymous approval and
 * no execute-first path.
 */
router.post('/:workspaceId/agents/runs/:runId/steps/:stepId/approve', async (req: AuthRequest, res, next) => {
  try {
    const runtime = await resolveAgentRuntime(req.userId!);
    const run = await approveStep(
      {
        runId: req.params.runId,
        workspaceId: req.params.workspaceId,
        stepId: req.params.stepId,
        approvedBy: req.userId!,
      },
      // Either kind of definition: this endpoint resumes agent runs and
      // workflow runs alike, and an agent-only resolver would fail every
      // parked workflow with "definition disappeared during the run".
      { ...runtime.deps, resolveDefinition: resolveAnyDefinition },
    );
    await persistRun(run.id);
    if (TERMINAL_RUN_STATES.includes(run.state)) {
      // Workflow runs resume through this endpoint too; the capability
      // line follows what the run actually is.
      await meterRun({
        run,
        capability: run.agentId.startsWith('wf_') ? 'workflow-run' : 'agent-run',
      });
    }
    res.json(createApiResponse(runResponse(run, runtime)));
  } catch (error) {
    next(toHttpError(error));
  }
});

/** A rejected step ends the run. It is refused, not skipped past. */
router.post('/:workspaceId/agents/runs/:runId/steps/:stepId/reject', async (req: AuthRequest, res, next) => {
  try {
    const { reason } = rejectSchema.parse(req.body ?? {});
    const run = rejectStep({
      runId: req.params.runId,
      workspaceId: req.params.workspaceId,
      stepId: req.params.stepId,
      rejectedBy: req.userId!,
      reason,
    });
    await persistRun(run.id);
    // Rejection is terminal; steps that ran before the park are billed.
    await meterRun({
      run,
      capability: run.agentId.startsWith('wf_') ? 'workflow-run' : 'agent-run',
    });
    res.json(createApiResponse(run));
  } catch (error) {
    next(toHttpError(error));
  }
});

/** The emergency stop. Always available while a run is not yet terminal. */
router.post('/:workspaceId/agents/runs/:runId/cancel', async (req: AuthRequest, res, next) => {
  try {
    const run = cancelRun(req.params.runId, req.params.workspaceId);
    await persistRun(run.id);
    res.json(createApiResponse(run));
  } catch (error) {
    next(toHttpError(error));
  }
});

// --- Definitions: single resource ----------------------------------------

router.get('/:workspaceId/agents/:agentId', async (req: AuthRequest, res, next) => {
  try {
    const agent = getAgent(req.params.agentId, req.params.workspaceId);
    if (!agent) return next(new NotFoundException('Agent'));
    res.json(createApiResponse(agent));
  } catch (error) {
    next(error);
  }
});

/**
 * Editing creates version+1 rather than mutating. The response is the NEW
 * version with a new id — callers must not assume the id they sent is still
 * the current one, because runs recorded against the old version continue to
 * resolve the old version, exactly as they executed it.
 */
router.patch('/:workspaceId/agents/:agentId', async (req: AuthRequest, res, next) => {
  try {
    const body = updateAgentSchema.parse(req.body);
    const next_ = updateAgent(req.params.agentId, req.params.workspaceId, body, req.userId!);
    await persistAgent(next_.id);
    res.json(createApiResponse(next_));
  } catch (error) {
    next(toHttpError(error));
  }
});

/** Every version in the lineage, oldest first — the audit history. */
router.get('/:workspaceId/agents/:agentId/history', async (req: AuthRequest, res, next) => {
  try {
    const agent = getAgent(req.params.agentId, req.params.workspaceId);
    if (!agent) return next(new NotFoundException('Agent'));
    res.json(createApiResponse(getAgentHistory(agent.lineageId, req.params.workspaceId)));
  } catch (error) {
    next(error);
  }
});

/**
 * Archiving, not deleting. An archived agent starts no new runs, but its
 * definition stays resolvable because historical runs reference it — the
 * same reason versions are immutable.
 */
router.delete('/:workspaceId/agents/:agentId', async (req: AuthRequest, res, next) => {
  try {
    const archived = archiveAgent(req.params.agentId, req.params.workspaceId);
    await persistAgent(archived.id);
    res.json(createApiResponse(archived));
  } catch (error) {
    next(toHttpError(error));
  }
});

// --- Runs: previewing the plan without starting anything ------------------
//
// The first stage of the command pipeline as its own read: the SAME
// planner, validation and per-step preflight a real run would use, and
// then a full stop. No run record is created and nothing executes. The
// runtime mode and notice ride along so the UI can label a local plan as
// local and a model plan as a model's — provenance is never collapsed.

router.post('/:workspaceId/agents/:agentId/runs/preview', async (req: AuthRequest, res, next) => {
  try {
    const { task } = z.object({ task: z.string().min(1).max(4000) }).parse(req.body);
    const agent = getAgent(req.params.agentId, req.params.workspaceId);
    if (!agent) return next(new NotFoundException('Agent'));

    const runtime = await resolveAgentRuntime(req.userId!);
    const report = await previewAgentPlan(
      {
        agent,
        workspaceId: req.params.workspaceId,
        requestedBy: req.userId!,
        task,
      },
      runtime.deps,
    );

    res.json(
      createApiResponse({
        ...report,
        runtime: { mode: runtime.mode, notice: runtime.notice },
      }),
    );
  } catch (error) {
    next(error);
  }
});

// --- Runs: starting one on a specific agent ------------------------------
//
// Unambiguous against the routes above because it has a trailing segment,
// so it does not need to precede `/agents/:agentId`.

router.post('/:workspaceId/agents/:agentId/runs', async (req: AuthRequest, res, next) => {
  try {
    const { task, projectId } = startRunSchema.parse(req.body);
    const agent = getAgent(req.params.agentId, req.params.workspaceId);
    if (!agent) return next(new NotFoundException('Agent'));

    // The project must belong to the SAME workspace as the run — the
    // project timeline reads runs by bare projectId, so filing into a
    // project of another workspace would plant a run somewhere the
    // requester's membership here says nothing about.
    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId: req.params.workspaceId },
        select: { id: true },
      });
      if (!project) return next(new NotFoundException('Project'));
    }

    // Refused BEFORE anything executes: at deduction time the work is
    // already done, which is too late for a budget to mean anything.
    await assertRunBudget(req.params.workspaceId);

    const runtime = await resolveAgentRuntime(req.userId!);

    // Recall happens BEFORE the run and only if the agent declares it.
    // Retrieval runs as the requesting user, so an agent can never surface
    // a memory the person who started it could not read.
    const recalled = canRecall(agent.memoryAccess)
      ? await recallForTask({ task, workspaceId: req.params.workspaceId, requestedBy: req.userId! })
      : '';

    const run = await startRun(
      {
        agentId: req.params.agentId,
        workspaceId: req.params.workspaceId,
        requestedBy: req.userId!,
        task,
        projectId,
      },
      { ...runtime.deps, generate: withRecalledContext(runtime.deps.generate, recalled) },
    );
    await persistRun(run.id);
    // Metered at the terminal transition, exactly once. A parked run is
    // metered later, when approval (or rejection) finishes it.
    if (TERMINAL_RUN_STATES.includes(run.state)) {
      await meterRun({ run, capability: 'agent-run' });
    }

    // Recorded only on success, and only if declared. The memory carries
    // the plan's origin in its text, so a deterministic run can never be
    // recalled later as though it were something a model produced.
    if (canRecord(agent.memoryAccess)) {
      await recordRunOutcome({ agent, run, requestedBy: req.userId! });
    }

    res.status(201).json(
      createApiResponse({
        ...runResponse(run, runtime),
        memory: {
          recalled: recalled.length > 0,
          recorded: canRecord(agent.memoryAccess) && run.state === 'completed',
        },
      }),
    );
  } catch (error) {
    next(toHttpError(error));
  }
});

export default router;
