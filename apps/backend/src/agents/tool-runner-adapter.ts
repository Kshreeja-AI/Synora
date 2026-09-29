import { toolService } from '../services/tool.service.js';
import type { AgentToolRunner } from './types.js';

/**
 * Adapts the real tool layer to the agent engine's `AgentToolRunner` seam.
 *
 * THE ADAPTER RIDES THE FULL SERVICE PATH, NEVER AROUND IT. Every
 * enforcement the tool layer applies to a human — workspace membership,
 * the `tool:execute` permission, active status, supported transport,
 * input-schema validation, rate limits, tool-level approval, the audit
 * record — applies identically to an agent, because the agent's tool
 * calls go through `toolService.executeTool` as the requesting user. An
 * agent is not a way to do what its requester could not do themselves.
 * This is the second permission layer; the engine's allowedTools check is
 * the first, and both must pass.
 *
 * TOOL-LEVEL APPROVAL FAILS FAST, DELIBERATELY. A tool marked
 * requiresApproval parks its execution as PENDING for a human in the
 * tools surface — an independent gate owned by the tool, not the agent.
 * An agent run cannot sit inside that wait: it would hold the run open
 * for an unbounded human timescale. So the adapter fails the step with
 * the execution id in the message, the run fails visibly, and the
 * operator can approve the execution and re-run. Hanging is the one
 * behaviour this engine never exhibits.
 */

export interface WorkspaceToolRunnerOptions {
  /** The user whose permissions the agent borrows. Always the requester. */
  requestedBy: string;
  /** Ceiling on waiting for the async execution to reach a terminal state. */
  maxWaitMs?: number;
  /** Poll interval while waiting. */
  pollIntervalMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL_EXECUTION_STATUSES = new Set(['COMPLETED', 'FAILED', 'TIMEOUT']);

/**
 * Step input is a string; tool input is a schema-validated object. A step
 * input that parses as a JSON object is passed through so plans can fill
 * structured tool schemas; anything else is wrapped as `{ input }`.
 */
export function toToolInput(stepInput: string): Record<string, unknown> {
  const trimmed = stepInput.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON after all — fall through to wrapping.
    }
  }
  return { input: stepInput };
}

export function createWorkspaceToolRunner(options: WorkspaceToolRunnerOptions): AgentToolRunner {
  const {
    requestedBy,
    maxWaitMs = 60_000,
    pollIntervalMs = 200,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  return {
    async execute({ toolId, workspaceId, input }) {
      const execution = await toolService.executeTool(requestedBy, workspaceId, toolId, {
        input: toToolInput(input),
      });

      if (execution.status === 'PENDING') {
        throw new Error(
          `tool ${toolId} requires its own approval — execution ${execution.id} is waiting in the ` +
            `tools surface. Approve it there and re-run; an agent cannot wait on a human timescale.`,
        );
      }

      const deadline = Date.now() + maxWaitMs;
      let current = execution;
      while (!TERMINAL_EXECUTION_STATUSES.has(current.status)) {
        if (Date.now() > deadline) {
          throw new Error(
            `tool ${toolId} did not finish within ${maxWaitMs}ms (execution ${execution.id} still ${current.status})`,
          );
        }
        await sleep(pollIntervalMs);
        current = await toolService.getExecution(requestedBy, workspaceId, execution.id);
      }

      if (current.status !== 'COMPLETED') {
        // The execution record is the source of truth for what went wrong;
        // the step error carries it so the run log answers "why".
        throw new Error(
          `tool ${toolId} ${current.status.toLowerCase()}: ${current.error ?? 'no error detail recorded'}`,
        );
      }

      return {
        output: typeof current.output === 'string' ? current.output : JSON.stringify(current.output ?? ''),
      };
    },
  };
}
