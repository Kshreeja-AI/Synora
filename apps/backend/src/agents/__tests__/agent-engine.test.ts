/**
 * Agent engine tests.
 *
 * The safety list from the phase directive is the specification here:
 * unauthorized tool use, cross-workspace access, approval bypass,
 * cancellation, timeout, retry exhaustion, malformed plans, loop
 * prevention, budgets — each one is a named test, and each one fails
 * closed. The happy path is tested too, but the happy path was never the
 * risk.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAgent,
  updateAgent,
  getAgent,
  getAgentHistory,
  listAgents,
  archiveAgent,
  resetAgents,
} from '../agent-registry';
import {
  startRun,
  approveStep,
  rejectStep,
  cancelRun,
  getRun,
  listRuns,
  validatePlan,
  resetRuns,
  type RunEngineDeps,
} from '../run-engine';
import {
  createDeterministicPlanner,
  createDeterministicToolRunner,
  createDeterministicGenerate,
} from '../local-runtime';

const WS = 'ws_alpha';
const OTHER_WS = 'ws_beta';

function deps(overrides: Partial<RunEngineDeps> = {}): RunEngineDeps {
  return {
    planner: createDeterministicPlanner(),
    toolRunner: createDeterministicToolRunner({
      echo: (input) => `echo:${input}`,
      flaky: () => {
        throw new Error('transient failure');
      },
    }),
    generate: createDeterministicGenerate(),
    ...overrides,
  };
}

function makeAgent(overrides: Parameters<typeof createAgent>[0] extends infer T ? Partial<T> : never = {}) {
  return createAgent({
    workspaceId: WS,
    name: 'Researcher',
    instructions: 'Answer concisely.',
    allowedTools: ['echo', 'flaky'],
    approvalPolicy: 'nothing',
    createdBy: 'user_1',
    ...overrides,
  });
}

describe('agent registry', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
  });

  it('creates agents that fail closed by default', () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'Bare',
      instructions: 'do things',
      createdBy: 'user_1',
    });

    // Unspecified tools means NO tools, and unspecified approval policy
    // means mutations pause for a human. Permissive defaults on an
    // autonomous executor are how agents silently gain access.
    expect(agent.allowedTools).toEqual([]);
    expect(agent.approvalPolicy).toBe('mutations');
  });

  it('refuses an agent without instructions or with a non-positive limit', () => {
    expect(() =>
      createAgent({ workspaceId: WS, name: 'X', instructions: '   ', createdBy: 'u' }),
    ).toThrow(/needs instructions/i);
    expect(() =>
      createAgent({
        workspaceId: WS,
        name: 'X',
        instructions: 'ok',
        createdBy: 'u',
        limits: { maxSteps: 0 },
      }),
    ).toThrow(/positive number/i);
  });

  it('editing creates a new immutable version linked to its predecessor', () => {
    const v1 = makeAgent();
    const v2 = updateAgent(v1.id, WS, { instructions: 'Answer in detail.' }, 'user_2');

    expect(v2.version).toBe(2);
    expect(v2.previousVersionId).toBe(v1.id);
    expect(v2.lineageId).toBe(v1.lineageId);
    // v1 is untouched — a run that referenced it still resolves it as it was.
    expect(getAgent(v1.id, WS)!.instructions).toBe('Answer concisely.');
    expect(getAgentHistory(v1.lineageId, WS).map((a) => a.version)).toEqual([1, 2]);
  });

  it('lists only the latest version per lineage', () => {
    const v1 = makeAgent();
    updateAgent(v1.id, WS, { name: 'Researcher 2' }, 'user_1');

    const listed = listAgents(WS);
    expect(listed).toHaveLength(1);
    expect(listed[0].version).toBe(2);
  });

  it('an agent in another workspace is indistinguishable from a nonexistent one', () => {
    const agent = makeAgent();
    expect(getAgent(agent.id, OTHER_WS)).toBeNull();
  });

  it('an archived agent cannot start runs or be edited', async () => {
    const agent = makeAgent();
    archiveAgent(agent.id, WS);

    await expect(
      startRun({ agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'x' }, deps()),
    ).rejects.toThrow(/archived/i);
    expect(() => updateAgent(agent.id, WS, { name: 'Y' }, 'u')).toThrow(/archived/i);
  });
});

describe('run lifecycle — the happy path', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
  });

  it('plans, executes tool and generate steps, and completes with a result', async () => {
    const agent = makeAgent();

    const run = await startRun(
      {
        agentId: agent.id,
        workspaceId: WS,
        requestedBy: 'user_1',
        task: 'tool!:echo hello\ngenerate summarise {{s1}}',
      },
      deps(),
    );

    expect(run.state).toBe('completed');
    expect(run.steps.map((s) => s.state)).toEqual(['succeeded', 'succeeded']);
    // Step 2 consumed step 1's output via the {{s1}} reference.
    expect(run.result).toBe('[local-deterministic] summarise echo:hello');
    // The record answers "what happened" on its own.
    expect(run.agentVersion).toBe(1);
    expect(run.plan!.origin).toBe('local-deterministic');
    expect(run.log.some((e) => e.event === 'run.completed')).toBe(true);
  });

  it('records which definition version a run executed under', async () => {
    const v1 = makeAgent();
    const v2 = updateAgent(v1.id, WS, { instructions: 'be thorough' }, 'u');

    const run = await startRun(
      { agentId: v2.id, workspaceId: WS, requestedBy: 'u', task: 'generate hi' },
      deps(),
    );

    expect(run.agentId).toBe(v2.id);
    expect(run.agentVersion).toBe(2);
  });
});

describe('permissions — every failure closes', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
  });

  it('refuses the whole run when the plan names a forbidden tool', async () => {
    const agent = makeAgent({ allowedTools: ['echo'] });

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:filesystem rm -rf' },
      deps(),
    );

    // Not skipped, refused: a planner reaching for forbidden tools is not
    // a planner whose remaining steps deserve trust.
    expect(run.state).toBe('failed');
    expect(run.error).toMatch(/not permitted to call/);
    expect(run.toolCallsUsed).toBe(0);
  });

  it('an agent with no declared tools can call none', async () => {
    const agent = makeAgent({ allowedTools: undefined });

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:echo hi' },
      deps(),
    );

    expect(run.state).toBe('failed');
    expect(run.error).toMatch(/not permitted/);
  });

  it('cannot start, read, or cancel a run across workspaces', async () => {
    const agent = makeAgent();

    await expect(
      startRun({ agentId: agent.id, workspaceId: OTHER_WS, requestedBy: 'u', task: 'x' }, deps()),
    ).rejects.toThrow(/agent not found/);

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'generate hi' },
      deps(),
    );
    expect(getRun(run.id, OTHER_WS)).toBeNull();
    expect(() => cancelRun(run.id, OTHER_WS)).toThrow(/run not found/);
  });
});

describe('approval gates', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
  });

  it('an undeclared tool step pauses under the mutations policy — fail closed', async () => {
    const agent = makeAgent({ approvalPolicy: 'mutations' });

    // 'tool:' (not 'tool!:') leaves mutating undeclared.
    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool:echo write-something' },
      deps(),
    );

    expect(run.state).toBe('awaiting_approval');
    expect(run.pendingApproval!.stepId).toBe('s1');
    // Nothing executed.
    expect(run.toolCallsUsed).toBe(0);
  });

  it('approval resumes execution and records who approved', async () => {
    const agent = makeAgent({ approvalPolicy: 'mutations' });
    const paused = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool:echo now' },
      deps(),
    );

    const resumed = await approveStep(
      { runId: paused.id, workspaceId: WS, stepId: 's1', approvedBy: 'founder' },
      deps(),
    );

    expect(resumed.state).toBe('completed');
    expect(resumed.steps[0].approvedBy).toBe('founder');
    expect(resumed.steps[0].output).toBe('echo:now');
  });

  it('rejection ends the run — a refused step is never skipped past', async () => {
    const agent = makeAgent({ approvalPolicy: 'everything' });
    const paused = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:echo a\ngenerate b' },
      deps(),
    );

    const ended = rejectStep({
      runId: paused.id,
      workspaceId: WS,
      stepId: 's1',
      rejectedBy: 'founder',
      reason: 'not like this',
    });

    expect(ended.state).toBe('cancelled');
    expect(ended.steps[1].state).toBe('pending'); // never ran
    expect(ended.toolCallsUsed).toBe(0);
  });

  it('approval cannot be bypassed: approving the wrong step is refused', async () => {
    const agent = makeAgent({ approvalPolicy: 'everything' });
    const paused = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:echo a' },
      deps(),
    );

    await expect(
      approveStep({ runId: paused.id, workspaceId: WS, stepId: 's99', approvedBy: 'x' }, deps()),
    ).rejects.toThrow(/not awaiting approval for that step/);
    // Still parked; still nothing executed.
    expect(getRun(paused.id, WS)!.state).toBe('awaiting_approval');
    expect(getRun(paused.id, WS)!.toolCallsUsed).toBe(0);
  });
});

describe('limits, retries, and termination', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
  });

  it('retries a failing step up to the budget, then fails the run honestly', async () => {
    const agent = makeAgent({ limits: { maxRetriesPerStep: 2 } });

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:flaky x' },
      deps(),
    );

    expect(run.state).toBe('failed');
    expect(run.steps[0].attempts).toBe(3); // 1 + 2 retries
    expect(run.error).toMatch(/after 3 attempt/);
  });

  it('refuses a plan longer than maxSteps — structural loop prevention', async () => {
    const agent = makeAgent({ limits: { maxSteps: 2 } });
    const task = Array.from({ length: 5 }, (_, i) => `generate line ${i}`).join('\n');

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task },
      deps(),
    );

    expect(run.state).toBe('failed');
    expect(run.error).toMatch(/over the agent's limit/);
  });

  it('stops at the tool call budget even when retries would exceed it', async () => {
    const agent = makeAgent({ limits: { maxToolCalls: 2, maxRetriesPerStep: 5 } });

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:flaky x' },
      deps(),
    );

    expect(run.state).toBe('failed');
    expect(run.toolCallsUsed).toBe(2);
    expect(run.error).toMatch(/budget/);
  });

  it('times out against the wall clock and reaches a terminal state', async () => {
    const agent = makeAgent({ limits: { maxDurationMs: 1000 } });
    let calls = 0;
    const clock = vi.fn(() => {
      calls += 1;
      // First check passes; the second finds the deadline exceeded.
      return calls > 1 ? Date.now() + 10_000 : Date.now();
    });

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'generate a\ngenerate b' },
      deps({ now: clock }),
    );

    expect(run.state).toBe('timed_out');
    expect(run.finishedAt).toBeGreaterThan(0);
  });

  it('cancellation of a parked run is immediate and terminal', async () => {
    const agent = makeAgent({ approvalPolicy: 'everything' });
    const paused = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:echo a' },
      deps(),
    );

    const cancelled = cancelRun(paused.id, WS);

    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.toolCallsUsed).toBe(0);
  });

  it('a failed dependency fails the run rather than executing on missing input', async () => {
    const rigged: RunEngineDeps = deps({
      planner: {
        async plan() {
          return {
            origin: 'local-deterministic',
            steps: [
              { id: 'a', kind: 'tool', description: 'fails', toolId: 'flaky', input: 'x', mutating: false },
              { id: 'b', kind: 'generate', description: 'uses a', input: 'use {{a}}', dependsOn: ['a'] },
            ],
          };
        },
      },
    });
    const agent = makeAgent({ limits: { maxRetriesPerStep: 0 } });

    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'ignored' },
      rigged,
    );

    expect(run.state).toBe('failed');
    expect(run.steps[1].state).not.toBe('succeeded');
  });
});

describe('malformed plans are refused whole', () => {
  const agentShape = { allowedTools: ['echo'], limits: { maxSteps: 10 } };

  it.each([
    [{ steps: [], origin: 'model' }, /empty plan/],
    [
      { steps: [{ id: 'a', kind: 'tool', description: '', input: '' }], origin: 'model' },
      /names no tool/,
    ],
    [
      {
        steps: [
          { id: 'a', kind: 'generate', description: '', input: '' },
          { id: 'a', kind: 'generate', description: '', input: '' },
        ],
        origin: 'model',
      },
      /duplicate id/,
    ],
    [
      { steps: [{ id: 'a', kind: 'teleport', description: '', input: '' }], origin: 'model' },
      /unknown kind/,
    ],
    [
      {
        steps: [{ id: 'a', kind: 'generate', description: '', input: '', dependsOn: ['a'] }],
        origin: 'model',
      },
      /does not precede it/,
    ],
  ] as const)('rejects: %j', (plan, expected) => {
    // Forward-only dependencies also make cycles unrepresentable.
    expect(validatePlan(plan as never, agentShape)).toMatch(expected);
  });
});

describe('the deterministic runtime stays labelled', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
  });

  it('every plan it produces is stamped local-deterministic, and output is marked', async () => {
    const agent = makeAgent();
    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'generate anything' },
      deps(),
    );

    // The stamp that keeps orchestration evidence from ever being passed
    // off as model intelligence.
    expect(run.plan!.origin).toBe('local-deterministic');
    expect(run.result).toContain('[local-deterministic]');
  });

  it('run listing is workspace-scoped', async () => {
    const agent = makeAgent();
    await startRun({ agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'generate x' }, deps());

    expect(listRuns(WS)).toHaveLength(1);
    expect(listRuns(OTHER_WS)).toHaveLength(0);
  });
});
