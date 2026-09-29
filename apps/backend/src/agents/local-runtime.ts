import type { AgentGenerate, AgentPlan, AgentPlanner, AgentToolRunner } from './types.js';

/**
 * Deterministic local runtime for the agent engine.
 *
 * WHAT THIS IS: a planner, tool runner, and generator with fully
 * predictable behaviour, so the ORCHESTRATION — lifecycle, permissions,
 * approvals, retries, budgets, cancellation — can be tested exactly.
 *
 * WHAT THIS IS NOT, stated as bluntly as the code can manage: this is not
 * intelligence, and nothing built on it may present its output as a
 * model's. Every plan it produces is stamped `origin:
 * 'local-deterministic'`, and that stamp travels with the run. Rendering
 * a deterministic run as evidence of AI capability would be fabrication —
 * the same offence as the fabricated embeddings this platform once
 * removed.
 *
 * The plan format it consumes is a deliberately trivial line syntax used
 * by tests and the local demo workspace:
 *
 *   tool:<toolId> <input...>        -> a tool step
 *   tool!:<toolId> <input...>       -> a tool step declared non-mutating
 *   generate <prompt...>            -> a generation step
 *
 * Anything else becomes a single generate step, so free-text tasks still
 * produce a valid one-step plan.
 */

export function createDeterministicPlanner(): AgentPlanner {
  return {
    async plan(request): Promise<AgentPlan> {
      const lines = request.task
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const steps = lines.map((line, index) => {
        const id = `s${index + 1}`;
        const toolMatch = /^tool(!?):([^\s]+)\s*(.*)$/.exec(line);
        if (toolMatch) {
          return {
            id,
            kind: 'tool' as const,
            description: `call ${toolMatch[2]}`,
            toolId: toolMatch[2],
            input: toolMatch[3],
            // 'tool!' declares the step non-mutating; plain 'tool' leaves
            // it undeclared, which the engine treats as mutating.
            ...(toolMatch[1] === '!' ? { mutating: false } : {}),
          };
        }
        const generateMatch = /^generate\s+(.*)$/.exec(line);
        return {
          id,
          kind: 'generate' as const,
          description: 'produce text',
          input: generateMatch ? generateMatch[1] : line,
        };
      });

      return { steps, origin: 'local-deterministic' };
    },
  };
}

/**
 * A tool runner over a fixed table of handlers. Unknown tools throw —
 * matching the real tool layer, where asking for a tool that does not
 * exist is an error, never a silent no-op.
 */
export function createDeterministicToolRunner(
  handlers: Record<string, (input: string, workspaceId: string) => string>,
): AgentToolRunner {
  return {
    async execute({ toolId, workspaceId, input }) {
      const handler = handlers[toolId];
      if (!handler) throw new Error(`no such tool: ${toolId}`);
      return { output: handler(input, workspaceId) };
    },
  };
}

/** Echo generator: output is a pure function of input, and looks like it. */
export function createDeterministicGenerate(): AgentGenerate {
  return async ({ prompt }) => ({
    // The prefix makes deterministic output unmistakable in any surface
    // that forgets to check the plan origin.
    text: `[local-deterministic] ${prompt}`,
  });
}
