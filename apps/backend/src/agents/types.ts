/**
 * The Synora agent model.
 *
 * DESIGN POSITION. An agent here is not a chat persona and not a vendor
 * SDK wrapper: it is a bounded executor — a named, versioned configuration
 * that turns a task into a finite plan and runs that plan inside explicit
 * limits, with every step recorded. The design questions that shaped this
 * are user questions, not competitor features: What is it allowed to do?
 * (allowedTools, approval policy.) How much can it spend? (limits.) What
 * did it actually do? (the run record and log.) Can I stop it? (cancel,
 * always.)
 *
 * TWO SEPARATIONS ARE LOAD-BEARING:
 *
 * 1. Orchestration vs intelligence. This module owns lifecycle, limits,
 *    permissions, retries, and history. It does not own thinking — a
 *    Planner produces the plan, and a planner may be model-backed or a
 *    deterministic local one used to test orchestration. The plan's
 *    `origin` field keeps those two forever distinguishable, because a
 *    deterministic plan proving the engine works must never be mistaken
 *    for evidence of model intelligence.
 *
 * 2. Definition vs run. Definitions are versioned and immutable — editing
 *    creates a new version pointing at its predecessor, so a run can
 *    always name the exact configuration it executed under, the same way
 *    an evaluation run names its dataset version.
 */

export interface AgentLimits {
  /** Hard ceiling on plan length and on steps executed. No unbounded runs. */
  maxSteps: number;
  /** Total tool invocations across the run, retries included. */
  maxToolCalls: number;
  /**
   * Wall-clock budget for the whole run.
   *
   * COUPLED TO THE HTTP REQUEST TIMEOUT, which nothing in the type system
   * enforces. A run currently executes inside the request that started it
   * (`await startRun(...)`), so a budget larger than
   * `DEFAULT_TIMEOUT_MS` in `middleware/requestTimeout.ts` means the
   * request dies while the run continues — spending budget nobody can
   * observe, under an id the caller never received. The default below is
   * already ten times that timeout; see the note in
   * `docs/SYNORA_MASTER_BLUEPRINT.md` §5.9 before raising either number.
   */
  maxDurationMs: number;
  /** Additional attempts per step after the first, for retryable failures. */
  maxRetriesPerStep: number;
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSteps: 20,
  maxToolCalls: 30,
  maxDurationMs: 5 * 60_000,
  maxRetriesPerStep: 2,
};

/**
 * When a run must pause for a human.
 * - `nothing`: fully autonomous within its other limits.
 * - `mutations`: any step marked mutating pauses for approval.
 * - `everything`: every tool step pauses for approval.
 */
export type ApprovalPolicy = 'nothing' | 'mutations' | 'everything';

export interface AgentDefinition {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  /** What this agent is for and how it should behave, in plain language. */
  instructions: string;
  /**
   * Tool ids this agent may invoke. Absent tools are forbidden — the
   * engine fails closed, so an empty list means a purely generative agent.
   */
  allowedTools: string[];
  approvalPolicy: ApprovalPolicy;
  /**
   * Whether this agent may read the workspace's memory, write to it, both,
   * or neither. Absent means NONE — memory is workspace data, and an agent
   * that silently read all of it would be a privacy problem wearing a
   * feature's clothes.
   */
  memoryAccess?: 'none' | 'recall' | 'record' | 'both';
  limits: AgentLimits;
  /** Monotonic per-lineage. Editing creates version+1; never mutates. */
  version: number;
  /** The definition this version supersedes, for audit history. */
  previousVersionId?: string;
  /** Stable across versions — what "the same agent over time" means. */
  lineageId: string;
  createdBy: string;
  createdAt: number;
  /** Archived definitions cannot start new runs; history remains. */
  archived: boolean;
}

export type PlannedStepKind = 'generate' | 'tool';

export interface PlannedStep {
  id: string;
  kind: PlannedStepKind;
  /** What this step is meant to accomplish, for the human reading the run. */
  description: string;
  /** kind=tool only. Must be in the agent's allowedTools or the plan is rejected. */
  toolId?: string;
  /** Input for the tool call or the generation prompt. */
  input: string;
  /**
   * Declared by the planner when a step changes state outside the run
   * (writes, sends, deletes). Drives the approval policy. A step with no
   * declaration is treated as mutating — fail closed, not open.
   */
  mutating?: boolean;
  /** Ids of steps whose output this step consumes. Must precede it. */
  dependsOn?: string[];
}

export interface AgentPlan {
  steps: PlannedStep[];
  /**
   * Where these steps came from. Three genuinely different things, and
   * conflating any two of them would misrepresent the system:
   *
   * - `model`: a real model produced this plan.
   * - `local-deterministic`: the orchestration-test planner did. It
   *   demonstrates the engine, not intelligence.
   * - `authored`: a human wrote these steps down, and the system followed
   *   them exactly. Nothing improvised. This is what a workflow is.
   */
  origin: 'model' | 'local-deterministic' | 'authored';
}

/**
 * What the run engine actually needs in order to execute something.
 *
 * WHY THIS EXISTS. The engine was written against `AgentDefinition`, but
 * nothing in the execution loop is specific to agents: it needs to know
 * the budgets, when to pause for a human, which tools are permitted, and
 * enough identity to record what ran. A workflow — a human-authored
 * sequence rather than an improvised one — needs exactly the same
 * treatment, and would otherwise mean a second copy of the retry,
 * approval, budget and cancellation logic. One executor, two ways of
 * deciding what the steps should be.
 */
export interface ExecutableDefinition {
  id: string;
  workspaceId: string;
  name: string;
  /** Used as the system prompt for `generate` steps. */
  instructions: string;
  allowedTools: string[];
  approvalPolicy: ApprovalPolicy;
  limits: AgentLimits;
  version: number;
  lineageId: string;
  archived: boolean;
}

export type RunState =
  | 'pending'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/** States a run can never leave. Every run must reach exactly one. */
export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
];

export type StepState = 'pending' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StepRecord {
  step: PlannedStep;
  state: StepState;
  /** Executions attempted, so retry behaviour is visible, not inferred. */
  attempts: number;
  output?: string;
  error?: string;
  /** Who approved this step, when approval was required. */
  approvedBy?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface RunLogEntry {
  at: number;
  event: string;
  detail?: string;
}

export interface AgentRun {
  id: string;
  /** The exact definition version this run executes under. */
  agentId: string;
  agentVersion: number;
  lineageId: string;
  workspaceId: string;
  requestedBy: string;
  task: string;
  /**
   * The project this run is filed into, if any — same-workspace, checked
   * at start time the same way a conversation's filing is: the project
   * timeline reads runs by bare projectId, so an unchecked one could
   * plant a run in a project the requester merely knows the id of.
   */
  projectId?: string;
  state: RunState;
  plan?: AgentPlan;
  steps: StepRecord[];
  /** Set while state is awaiting_approval. */
  pendingApproval?: { stepId: string; reason: string };
  toolCallsUsed: number;
  /** Final answer assembled from step outputs, present only on completion. */
  result?: string;
  error?: string;
  /** Append-only history of everything that happened, for the audit trail. */
  log: RunLogEntry[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * Produces a plan for a task. Model-backed in production; deterministic in
 * tests. The engine treats every planner as untrusted: plans are validated
 * against the agent's permissions and limits before a single step runs.
 */
export interface AgentPlanner {
  plan(request: {
    task: string;
    instructions: string;
    allowedTools: string[];
  }): Promise<AgentPlan>;
}

/**
 * Executes one tool call. The engine performs the permission check BEFORE
 * calling this; implementations still receive workspaceId because tool
 * ownership is enforced at the tool layer too — two layers, not one.
 */
export interface AgentToolRunner {
  execute(request: {
    toolId: string;
    workspaceId: string;
    input: string;
  }): Promise<{ output: string }>;
}

/** Text generation for `generate` steps. Same injected shape as the judge. */
export type AgentGenerate = (request: {
  prompt: string;
  systemPrompt?: string;
}) => Promise<{ text: string }>;
