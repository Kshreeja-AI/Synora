import type { AgentGenerate, AgentPlan, AgentPlanner, PlannedStep } from './types.js';

/**
 * A planner backed by a real model, through the same injected-generate
 * seam as the evaluation judge — no vendor is named here, and whichever
 * provider is configured serves the plan.
 *
 * THE SAME HONESTY RULE AS THE JUDGE APPLIES TO PARSING. A model asked
 * for a JSON plan will sometimes return perfect JSON, sometimes JSON in a
 * code fence, sometimes prose with JSON buried in it, sometimes a
 * refusal. Coercing any of those into "a plan" would hand the run engine
 * fabricated steps. So parsing is strict — a fenced or bare JSON array
 * and nothing else — and anything unreadable throws, which the engine
 * records as a failed planning phase with the reason attached. A run that
 * fails at planning is honest; a run executing a guessed plan is not.
 *
 * THE ENGINE REMAINS THE ENFORCER. This module maps and shapes; it does
 * not authorize. Whatever the model emits is validated again by
 * validatePlan against the agent's allowedTools and limits before any
 * step runs. A planner is untrusted by contract, including this one.
 */

export const PLANNER_SYSTEM_PROMPT = [
  'You turn a task into a short, concrete execution plan for an agent.',
  'Reply with a JSON array and NOTHING else. Each element:',
  '{"kind":"tool"|"generate","description":string,"input":string,',
  ' "tool":string (required when kind is "tool"),',
  ' "mutating":boolean (tool steps: true if the call changes state outside this run),',
  ' "dependsOn":number[] (0-based indexes of EARLIER steps whose output this step needs)}',
  'Rules:',
  '- Use only the tools listed in the prompt. If none fit, use generate steps.',
  '- Reference an earlier step\'s output by writing {{sN}} in input, where N is its 1-based position.',
  '- Keep plans as short as the task allows.',
  '- If the task cannot be planned, reply with exactly: UNPLANNABLE: <one-line reason>',
].join('\n');

export function buildPlannerPrompt(request: {
  task: string;
  instructions: string;
  allowedTools: string[];
}): string {
  return [
    `AGENT INSTRUCTIONS:\n${request.instructions}`,
    `AVAILABLE TOOLS:\n${request.allowedTools.length > 0 ? request.allowedTools.join(', ') : '(none — generate steps only)'}`,
    `TASK:\n${request.task}`,
    'PLAN (JSON array only):',
  ].join('\n\n');
}

interface RawStep {
  kind?: unknown;
  description?: unknown;
  input?: unknown;
  tool?: unknown;
  mutating?: unknown;
  dependsOn?: unknown;
}

/**
 * Reads a plan from a model reply, or refuses.
 *
 * Accepts a bare JSON array, or one inside a single ``` fence — the one
 * deviation tolerated, because it is unambiguous and near-universal.
 * Everything else throws with the reason.
 */
export function parseModelPlan(reply: string): AgentPlan {
  const trimmed = reply.trim();
  if (trimmed.length === 0) throw new Error('planner returned an empty reply');

  const unplannable = /^UNPLANNABLE:\s*(.+)$/s.exec(trimmed);
  if (unplannable) {
    throw new Error(`planner declined: ${unplannable[1].trim().slice(0, 200)}`);
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  if (!body.startsWith('[')) {
    throw new Error(`planner reply was not a JSON array: ${JSON.stringify(body.slice(0, 80))}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (err) {
    throw new Error(`planner reply was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('planner reply parsed to something other than a non-empty array');
  }

  const steps: PlannedStep[] = (raw as RawStep[]).map((entry, index) => {
    const id = `s${index + 1}`;
    if (entry.kind !== 'tool' && entry.kind !== 'generate') {
      throw new Error(`plan step ${index} has invalid kind ${JSON.stringify(entry.kind)}`);
    }
    if (typeof entry.input !== 'string') {
      throw new Error(`plan step ${index} has no string input`);
    }
    if (entry.kind === 'tool' && typeof entry.tool !== 'string') {
      throw new Error(`plan step ${index} is a tool step but names no tool`);
    }

    let dependsOn: string[] | undefined;
    if (entry.dependsOn !== undefined) {
      if (!Array.isArray(entry.dependsOn) || entry.dependsOn.some((d) => !Number.isInteger(d))) {
        throw new Error(`plan step ${index} has a malformed dependsOn`);
      }
      // 0-based model indexes to our 1-based step ids. Range and
      // backwards-only are re-checked by validatePlan; this only maps.
      dependsOn = (entry.dependsOn as number[]).map((d) => `s${d + 1}`);
    }

    return {
      id,
      kind: entry.kind,
      description:
        typeof entry.description === 'string' && entry.description.length > 0
          ? entry.description
          : entry.kind === 'tool'
            ? `call ${String(entry.tool)}`
            : 'produce text',
      input: entry.input,
      ...(entry.kind === 'tool' ? { toolId: entry.tool as string } : {}),
      // Only an explicit false counts as non-mutating; absence stays
      // undefined so the engine's fail-closed default applies.
      ...(entry.mutating === false ? { mutating: false } : entry.mutating === true ? { mutating: true } : {}),
      ...(dependsOn ? { dependsOn } : {}),
    };
  });

  return { steps, origin: 'model' };
}

/** Builds a planner that asks a real model. */
export function createModelPlanner(generate: AgentGenerate): AgentPlanner {
  return {
    async plan(request): Promise<AgentPlan> {
      const result = await generate({
        prompt: buildPlannerPrompt(request),
        systemPrompt: PLANNER_SYSTEM_PROMPT,
      });
      return parseModelPlan(result.text);
    },
  };
}
