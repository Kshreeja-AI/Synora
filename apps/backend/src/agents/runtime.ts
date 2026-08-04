import { generateText } from '../ai/index.js';
import { resolveTextGenerationProvider } from '../ai/resolver.js';
import { createModelPlanner } from './model-planner.js';
import { createWorkspaceToolRunner } from './tool-runner-adapter.js';
import { createDeterministicGenerate, createDeterministicPlanner } from './local-runtime.js';
import type { RunEngineDeps } from './run-engine.js';
import type { ExecutableDefinition } from './types.js';
import { getAgent } from './agent-registry.js';
import { getWorkflow } from '../workflows/workflow-registry.js';
import { logger } from '../utils/logger.js';

/**
 * Assembles the dependencies a run executes with, and — just as important —
 * reports which kind of intelligence produced them.
 *
 * WHY THIS IS A SEPARATE MODULE, like `judge-wiring.ts`. The registry, the
 * run engine, and the planners all deliberately know nothing about provider
 * wiring: they take injected functions, which keeps them testable against
 * fabricated model replies and unable to reach a vendor even by accident.
 * This is the single place those halves are joined.
 *
 * WHY THE MODE IS RETURNED RATHER THAN INFERRED. The engine can run on a
 * deterministic local planner so orchestration is testable with no
 * credentials and no spend. That planner is scaffolding, not thinking, and
 * the founder directive is explicit that a mock executor must never be
 * presented as equivalent to real AI. So the mode travels with the
 * dependencies, is stamped into every plan's `origin`, and is surfaced on
 * the API response — a caller cannot receive a run without also being told
 * what produced it.
 *
 * `local` here means exactly one thing: the platform is following a written
 * grammar, not reasoning. It is honest, useful for building everything
 * around it, and not a product feature.
 */

export type AgentRuntimeMode = 'model' | 'local';

/**
 * Resolves a definition from either registry.
 *
 * WHY THIS IS NEEDED. Runs are approved, rejected and cancelled through
 * one set of endpoints regardless of what produced them, because from a
 * caller's point of view a parked run is a parked run. But `approveStep`
 * must re-resolve the definition to continue executing, and a resolver
 * that only knew agents would fail every parked WORKFLOW run with
 * "definition disappeared during the run" — a confusing message for a
 * workflow that is sitting right there. Same reasoning as the boot-time
 * orphan check, which also has to know about both.
 */
export function resolveAnyDefinition(id: string, workspaceId: string): ExecutableDefinition | null {
  return getAgent(id, workspaceId) ?? getWorkflow(id, workspaceId);
}

export interface ResolvedAgentRuntime {
  deps: RunEngineDeps;
  mode: AgentRuntimeMode;
  /** Provider id when mode is `model`; absent otherwise. */
  provider?: string;
  /**
   * Plain-language explanation of what the caller is actually getting.
   * Carried on the response so a UI never has to invent this wording, and
   * so "local" can never quietly render as if it were a model.
   */
  notice: string;
}

const LOCAL_NOTICE =
  'LOCAL: no AI provider is configured, so this run was planned by a deterministic local planner that follows a fixed grammar. It demonstrates orchestration — permissions, approvals, limits, history — not model intelligence.';

const MODEL_NOTICE =
  'REAL: this run was planned by a configured AI provider. The plan was still re-validated against the agent\'s permissions and limits before any step executed.';

/**
 * Resolves the runtime for one request. Called per-request rather than
 * cached because the tool runner is bound to the requesting user: an agent
 * executes tools AS the human who started it, never with ambient authority,
 * so a cached runner would let one user's run inherit another's permissions.
 */
export async function resolveAgentRuntime(requestedBy: string): Promise<ResolvedAgentRuntime> {
  const toolRunner = createWorkspaceToolRunner({ requestedBy });

  let provider: string;
  try {
    provider = (await resolveTextGenerationProvider()).id;
  } catch (err) {
    // No provider configured is the expected state before any credentials
    // exist. It is not an error and must not read as one — but it also must
    // not be invisible, because a run planned locally is a materially
    // different thing from a run planned by a model.
    logger.info('Agent runtime falling back to the deterministic local planner: no text provider configured.', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return {
      deps: {
        planner: createDeterministicPlanner(),
        toolRunner,
        generate: createDeterministicGenerate(),
      },
      mode: 'local',
      notice: LOCAL_NOTICE,
    };
  }

  return {
    deps: {
      planner: createModelPlanner((request) => generateText(request)),
      toolRunner,
      generate: (request) => generateText(request),
    },
    mode: 'model',
    provider,
    notice: MODEL_NOTICE,
  };
}
