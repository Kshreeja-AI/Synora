import { randomUUID } from 'node:crypto';
import { getAgent, hasAgentDefinition } from './agent-registry.js';
import { getAgentRunStore } from './agent-stores.js';
import {
  TERMINAL_RUN_STATES,
  type AgentGenerate,
  type AgentPlan,
  type AgentPlanner,
  type AgentRun,
  type AgentToolRunner,
  type ExecutableDefinition,
  type PlannedStep,
  type RunState,
  type StepRecord,
} from './types.js';

/**
 * Executes agent runs. Everything here is about boundaries:
 *
 * - A run has exactly one lifecycle and must reach a terminal state.
 *   There is no code path that leaves a run "running" forever — the loop
 *   is bounded by the plan length, which is bounded by maxSteps, and the
 *   wall clock is checked before every step.
 *
 * - Plans are untrusted input. A planner is a model (or a test double),
 *   and the engine validates its output against the agent's permissions
 *   and limits before executing anything. A plan naming a tool outside
 *   allowedTools does not "skip that step" — the whole run is refused,
 *   because a planner that reaches for forbidden tools is not a planner
 *   whose remaining steps deserve trust.
 *
 * - Approval is a state, not a prompt. When a step requires it, the run
 *   parks in `awaiting_approval` and nothing executes until a named human
 *   approves or rejects. There is deliberately no way to execute the step
 *   first and record the approval later.
 *
 * - Everything is recorded. The run log is append-only; step records keep
 *   attempts, outputs, errors, and who approved what. The question "what
 *   did the agent actually do" must always be answerable from the record
 *   alone.
 *
 * WHAT IT EXECUTES. The engine deliberately knows nothing about agents
 * beyond `ExecutableDefinition` — the budgets, the approval policy, the
 * permitted tools, and enough identity to record what ran. Agents resolve
 * through the default resolver; workflows supply their own. That is one
 * executor with two ways of deciding what the steps should be, rather than
 * a second copy of the retry, approval, budget and cancellation logic.
 *
 * DURABILITY: runs are held in memory as the working set and written
 * through to a keyed store, hydrated at boot. See `agent-stores.ts`.
 */

const runs = new Map<string, AgentRun>();
const cancelRequests = new Set<string>();

export interface RunEngineDeps {
  planner: AgentPlanner;
  toolRunner: AgentToolRunner;
  generate: AgentGenerate;
  /** Injectable clock so timeout behaviour is testable deterministically. */
  now?: () => number;
  /**
   * How a run resolves the definition it executes under. Defaults to the
   * agent registry; workflows pass their own so the engine can execute an
   * authored sequence without the registry knowing workflows exist.
   * Workspace-scoped like every other lookup: elsewhere means nonexistent.
   */
  resolveDefinition?: (id: string, workspaceId: string) => ExecutableDefinition | null;
}

function definitionResolver(deps: RunEngineDeps) {
  return deps.resolveDefinition ?? getAgent;
}

function log(run: AgentRun, event: string, detail?: string): void {
  run.log.push({ at: Date.now(), event, detail });
}

function finish(run: AgentRun, state: RunState, error?: string): AgentRun {
  run.state = state;
  run.error = error;
  run.finishedAt = Date.now();
  log(run, `run.${state}`, error);
  cancelRequests.delete(run.id);
  return run;
}

/**
 * Validates a plan against the agent's boundaries. Returns the reason it
 * is unacceptable, or null. Runs BEFORE any step executes: a bad plan is
 * refused whole rather than partially executed.
 */
export function validatePlan(
  plan: AgentPlan,
  agent: { allowedTools: string[]; limits: { maxSteps: number } },
): string | null {
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return 'the planner produced an empty plan';
  }
  if (plan.steps.length > agent.limits.maxSteps) {
    return `plan has ${plan.steps.length} steps, over the agent's limit of ${agent.limits.maxSteps}`;
  }

  const ids = new Set<string>();
  const allowed = new Set(agent.allowedTools);
  for (const [index, step] of plan.steps.entries()) {
    if (!step.id || ids.has(step.id)) return `step ${index} has a missing or duplicate id`;

    if (step.kind !== 'tool' && step.kind !== 'generate') {
      return `step ${step.id} has unknown kind ${JSON.stringify(String(step.kind))}`;
    }
    if (step.kind === 'tool') {
      if (!step.toolId) return `tool step ${step.id} names no tool`;
      if (!allowed.has(step.toolId)) {
        // The permission failure, failing closed. Not skipped: refused.
        return `step ${step.id} uses tool "${step.toolId}", which this agent is not permitted to call`;
      }
    }
    // Dependencies are checked BEFORE this step's own id joins the set, so
    // a self-dependency fails here too. Only strictly earlier ids qualify:
    // execution order is plan order, dependencies may only point backwards,
    // and that makes cycles structurally unrepresentable.
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) {
        return `step ${step.id} depends on "${dep}", which does not precede it`;
      }
    }
    ids.add(step.id);
  }
  return null;
}

function stepNeedsApproval(step: PlannedStep, policy: string): boolean {
  if (step.kind !== 'tool') return false;
  if (policy === 'everything') return true;
  if (policy === 'nothing') return false;
  // 'mutations' — and an undeclared step is treated as mutating. A planner
  // that forgot to say is not a reason to skip the human.
  return step.mutating !== false;
}

/** Substitutes {{stepId}} references with the named step's output. */
function resolveInput(input: string, steps: StepRecord[]): string {
  return input.replace(/\{\{([^}]+)\}\}/g, (whole, id: string) => {
    const dep = steps.find((s) => s.step.id === id.trim());
    return dep?.output ?? whole;
  });
}

/**
 * Starts a run: resolves the agent (workspace-scoped), plans, validates,
 * then executes until a terminal state or an approval pause.
 */
export async function startRun(
  params: { agentId: string; workspaceId: string; requestedBy: string; task: string },
  deps: RunEngineDeps,
): Promise<AgentRun> {
  const agent = definitionResolver(deps)(params.agentId, params.workspaceId);
  if (!agent) {
    // Cross-workspace and nonexistent are deliberately the same answer.
    throw new Error('agent not found');
  }
  if (agent.archived) throw new Error('this agent is archived and cannot start new runs');
  if (params.task.trim().length === 0) throw new Error('a run needs a task');

  const run: AgentRun = {
    id: `run_${randomUUID()}`,
    agentId: agent.id,
    agentVersion: agent.version,
    lineageId: agent.lineageId,
    workspaceId: agent.workspaceId,
    requestedBy: params.requestedBy,
    task: params.task,
    state: 'planning',
    steps: [],
    toolCallsUsed: 0,
    log: [],
    createdAt: Date.now(),
  };
  runs.set(run.id, run);
  log(run, 'run.created', `agent ${agent.name} v${agent.version}`);

  let plan: AgentPlan;
  try {
    plan = await deps.planner.plan({
      task: params.task,
      instructions: agent.instructions,
      allowedTools: agent.allowedTools,
    });
  } catch (err) {
    return finish(run, 'failed', `planning failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rejection = validatePlan(plan, agent);
  if (rejection) {
    return finish(run, 'failed', `plan rejected: ${rejection}`);
  }

  run.plan = plan;
  run.steps = plan.steps.map((step) => ({ step, state: 'pending', attempts: 0 }));
  log(run, 'run.planned', `${plan.steps.length} step(s), origin ${plan.origin}`);

  run.state = 'running';
  run.startedAt = Date.now();
  return executeFrom(run, agent, deps);
}

/**
 * The execution loop. Bounded by the validated plan length; checks the
 * clock, the cancel flag, and the tool budget before every step.
 */
async function executeFrom(
  run: AgentRun,
  agent: ExecutableDefinition,
  deps: RunEngineDeps,
): Promise<AgentRun> {
  const now = deps.now ?? Date.now;
  const deadline = (run.startedAt ?? now()) + agent.limits.maxDurationMs;

  for (const record of run.steps) {
    if (record.state === 'succeeded' || record.state === 'skipped') continue;

    if (cancelRequests.has(run.id)) {
      record.state = 'skipped';
      return finish(run, 'cancelled', `cancelled before step ${record.step.id}`);
    }
    if (now() > deadline) {
      record.state = 'skipped';
      return finish(run, 'timed_out', `exceeded ${agent.limits.maxDurationMs}ms`);
    }

    // A dependency that failed means this step's input does not exist.
    const missingDep = (record.step.dependsOn ?? []).find(
      (dep) => run.steps.find((s) => s.step.id === dep)?.state !== 'succeeded',
    );
    if (missingDep) {
      record.state = 'skipped';
      return finish(run, 'failed', `step ${record.step.id} depends on failed step ${missingDep}`);
    }

    // Approval gate. Park the run; resumeRun re-enters this loop and the
    // approved record (state set by approveStep) executes below.
    if (
      record.state !== 'awaiting_approval' &&
      !record.approvedBy &&
      stepNeedsApproval(record.step, agent.approvalPolicy)
    ) {
      record.state = 'awaiting_approval';
      run.state = 'awaiting_approval';
      run.pendingApproval = {
        stepId: record.step.id,
        reason:
          record.step.mutating === false
            ? 'agent policy requires approval for every tool call'
            : 'this step may change state outside the run',
      };
      log(run, 'run.awaiting_approval', record.step.id);
      return run;
    }
    if (record.state === 'awaiting_approval') {
      // Still parked — resumeRun only proceeds past this after approval.
      return run;
    }

    // Execute, with the per-step retry budget.
    const maxAttempts = 1 + agent.limits.maxRetriesPerStep;
    record.state = 'running';
    record.startedAt = Date.now();

    let lastError = '';
    let succeeded = false;
    while (record.attempts < maxAttempts) {
      if (record.step.kind === 'tool' && run.toolCallsUsed >= agent.limits.maxToolCalls) {
        record.state = 'failed';
        record.error = 'tool call budget exhausted';
        return finish(run, 'failed', `tool call budget (${agent.limits.maxToolCalls}) exhausted at step ${record.step.id}`);
      }

      record.attempts += 1;
      try {
        const input = resolveInput(record.step.input, run.steps);
        if (record.step.kind === 'tool') {
          run.toolCallsUsed += 1;
          const result = await deps.toolRunner.execute({
            toolId: record.step.toolId!,
            workspaceId: run.workspaceId,
            input,
          });
          record.output = result.output;
        } else {
          const result = await deps.generate({
            prompt: input,
            systemPrompt: agent.instructions,
          });
          record.output = result.text;
        }
        succeeded = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log(run, 'step.attempt_failed', `${record.step.id} attempt ${record.attempts}: ${lastError}`);
      }
    }

    record.finishedAt = Date.now();
    if (!succeeded) {
      record.state = 'failed';
      record.error = lastError;
      return finish(run, 'failed', `step ${record.step.id} failed after ${record.attempts} attempt(s): ${lastError}`);
    }
    record.state = 'succeeded';
    log(run, 'step.succeeded', record.step.id);
  }

  // The final answer is the last step's output — plans end with the step
  // that produces what the user asked for.
  run.result = run.steps[run.steps.length - 1]?.output;
  return finish(run, 'completed');
}

/** Approves the pending step and resumes execution. */
export async function approveStep(
  params: { runId: string; workspaceId: string; stepId: string; approvedBy: string },
  deps: RunEngineDeps,
): Promise<AgentRun> {
  const run = getRun(params.runId, params.workspaceId);
  if (!run) throw new Error('run not found');
  if (run.state !== 'awaiting_approval' || run.pendingApproval?.stepId !== params.stepId) {
    throw new Error('this run is not awaiting approval for that step');
  }

  const record = run.steps.find((s) => s.step.id === params.stepId)!;
  record.approvedBy = params.approvedBy;
  record.state = 'pending';
  run.pendingApproval = undefined;
  run.state = 'running';
  log(run, 'step.approved', `${params.stepId} by ${params.approvedBy}`);

  const agent = definitionResolver(deps)(run.agentId, run.workspaceId);
  if (!agent) return finish(run, 'failed', 'agent definition disappeared during the run');
  return executeFrom(run, agent, deps);
}

/** Rejects the pending step. The run ends — a refused step is not skipped. */
export function rejectStep(params: {
  runId: string;
  workspaceId: string;
  stepId: string;
  rejectedBy: string;
  reason?: string;
}): AgentRun {
  const run = getRun(params.runId, params.workspaceId);
  if (!run) throw new Error('run not found');
  if (run.state !== 'awaiting_approval' || run.pendingApproval?.stepId !== params.stepId) {
    throw new Error('this run is not awaiting approval for that step');
  }
  const record = run.steps.find((s) => s.step.id === params.stepId)!;
  record.state = 'skipped';
  run.pendingApproval = undefined;
  log(run, 'step.rejected', `${params.stepId} by ${params.rejectedBy}${params.reason ? `: ${params.reason}` : ''}`);
  return finish(run, 'cancelled', `step ${params.stepId} was rejected by ${params.rejectedBy}`);
}

/**
 * Requests cancellation. Takes effect at the next step boundary for a
 * running run; immediately for a parked one. The emergency stop.
 */
export function cancelRun(runId: string, workspaceId: string): AgentRun {
  const run = getRun(runId, workspaceId);
  if (!run) throw new Error('run not found');
  if (TERMINAL_RUN_STATES.includes(run.state)) return run;

  if (run.state === 'awaiting_approval' || run.state === 'pending' || run.state === 'planning') {
    return finish(run, 'cancelled', 'cancelled by user');
  }
  cancelRequests.add(run.id);
  log(run, 'run.cancel_requested');
  return run;
}

/** Workspace-scoped, like every other lookup: elsewhere means nonexistent. */
export function getRun(runId: string, workspaceId: string): AgentRun | null {
  const run = runs.get(runId);
  if (!run || run.workspaceId !== workspaceId) return null;
  return run;
}

export function listRuns(workspaceId: string, opts: { agentLineageId?: string } = {}): AgentRun[] {
  return [...runs.values()]
    .filter((r) => r.workspaceId === workspaceId)
    .filter((r) => !opts.agentLineageId || r.lineageId === opts.agentLineageId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Writes a run through to the durable store. */
export async function persistRun(runId: string): Promise<boolean> {
  const run = runs.get(runId);
  if (!run) return false;
  await getAgentRunStore().save(run.id, run);
  return true;
}

/**
 * Loads runs at startup, and REFUSES ONES WHOSE AGENT DEFINITION IS GONE.
 *
 * This is the benchmark-registry deadlock generalised. A run names the
 * exact definition version it executed under; restoring a run whose
 * definition was not restored produces a record that cannot be resumed,
 * cannot be explained, and — for a parked run — cannot be approved,
 * because `approveStep` resolves the agent before continuing. Hydrating
 * such a run would look like recovery and behave like corruption.
 *
 * Definitions must therefore be hydrated FIRST. A run that still cannot
 * find its definition is skipped and counted, so the loss is visible
 * rather than silent.
 *
 * `isDefinitionKnown` exists because the run store holds every kind of
 * run, and a workflow run's definition lives in the workflow registry
 * rather than the agent registry. Defaulting to the agent registry alone
 * would orphan every workflow run on restart — a guard against corruption
 * turning into a cause of data loss. Boot passes a check that covers both.
 */
export async function hydrateRuns(
  isDefinitionKnown: (definitionId: string) => boolean = hasAgentDefinition,
): Promise<{ loaded: number; orphaned: number }> {
  const stored = await getAgentRunStore().loadAll();
  let loaded = 0;
  let orphaned = 0;

  for (const run of Object.values(stored)) {
    if (!run?.id || !run.workspaceId || !run.agentId) continue;
    if (!isDefinitionKnown(run.agentId)) {
      orphaned += 1;
      continue;
    }
    // A run interrupted mid-flight cannot silently resume: the process
    // that owned its loop is gone. It is restored in a terminal state so
    // history is preserved and nothing pretends to still be running.
    if (!TERMINAL_RUN_STATES.includes(run.state) && run.state !== 'awaiting_approval') {
      run.state = 'failed';
      run.error = 'interrupted by a restart — the executing process no longer exists';
      run.finishedAt = run.finishedAt ?? Date.now();
      run.log.push({ at: Date.now(), event: 'run.failed', detail: run.error });
    }
    runs.set(run.id, run);
    loaded += 1;
  }
  return { loaded, orphaned };
}

/** Test-only. */
export function resetRuns(): void {
  runs.clear();
  cancelRequests.clear();
}
