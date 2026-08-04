import type { AgentLimits, ApprovalPolicy, PlannedStep } from '../agents/types.js';

/**
 * Workflows: sequences a human wrote down, executed exactly as written.
 *
 * THE DISTINCTION FROM AGENTS, which is the whole point. An agent is given
 * a goal and improvises a plan to reach it. A workflow is given the plan.
 * Nothing decides what the steps should be, because a person already did.
 *
 * That difference matters to a user in a way worth stating plainly: an
 * agent might do something you did not anticipate, which is sometimes what
 * you want and sometimes exactly what you fear. A workflow does the same
 * thing every time. When someone says "automation" they usually mean this,
 * not the other.
 *
 * WHAT IS DELIBERATELY SHARED. Everything about *running* the steps —
 * permission checks, approval gates, retry budgets, tool-call budgets, the
 * wall clock, cancellation, and the append-only record — is the agent run
 * engine, unchanged. Those properties were hard to get right and there is
 * no version of them that should be true for agents and false for
 * workflows. A workflow supplies its steps and its own definition
 * resolver; the engine treats it identically from there.
 *
 * Plans produced this way are stamped `origin: 'authored'`, distinct from
 * both `model` and `local-deterministic`, so no surface can imply that a
 * human-written sequence was reasoning.
 */

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  /**
   * Context for `generate` steps — the equivalent of an agent's
   * instructions, and the reason `ExecutableDefinition` is satisfied.
   */
  instructions: string;
  /** The authored sequence. Validated when saved, not only when run. */
  steps: PlannedStep[];
  allowedTools: string[];
  approvalPolicy: ApprovalPolicy;
  limits: AgentLimits;
  version: number;
  previousVersionId?: string;
  lineageId: string;
  createdBy: string;
  createdAt: number;
  archived: boolean;
}
