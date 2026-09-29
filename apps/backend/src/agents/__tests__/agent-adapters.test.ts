/**
 * Adapter tests: the model planner's strict parsing, and the tool-runner
 * adapter's ride-the-service-path behaviour.
 *
 * The tool layer itself has DB-backed tests of its own; here the service
 * is mocked so what is under test is exactly the adapter's contract —
 * permission borrowing, PENDING fail-fast, polling, terminal-state
 * honesty — not the tool engine again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const toolServiceMock = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getExecution: vi.fn(),
}));
vi.mock('../../services/tool.service.js', () => ({ toolService: toolServiceMock }));

import { createWorkspaceToolRunner, toToolInput } from '../tool-runner-adapter';
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerPrompt,
  createModelPlanner,
  parseModelPlan,
} from '../model-planner';
import { validatePlan } from '../run-engine';

describe('model planner parsing', () => {
  it('parses a bare JSON array into a plan stamped origin:model', () => {
    const plan = parseModelPlan(
      JSON.stringify([
        { kind: 'tool', tool: 'search', input: 'query', mutating: false, description: 'look up' },
        { kind: 'generate', input: 'summarise {{s1}}', dependsOn: [0] },
      ]),
    );

    expect(plan.origin).toBe('model');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({ id: 's1', kind: 'tool', toolId: 'search', mutating: false });
    // 0-based model index mapped to our 1-based step id.
    expect(plan.steps[1].dependsOn).toEqual(['s1']);
  });

  it('accepts a single code fence, the one tolerated deviation', () => {
    const plan = parseModelPlan('```json\n[{"kind":"generate","input":"hi"}]\n```');
    expect(plan.steps).toHaveLength(1);
  });

  it('refuses prose, empty replies, and buried JSON rather than guessing', () => {
    expect(() => parseModelPlan('Here is my plan: [..]')).toThrow(/not a JSON array/);
    expect(() => parseModelPlan('')).toThrow(/empty reply/);
    expect(() => parseModelPlan('I would first search, then summarise.')).toThrow(/not a JSON array/);
  });

  it('honours an explicit refusal', () => {
    expect(() => parseModelPlan('UNPLANNABLE: task requires tools this agent lacks')).toThrow(
      /planner declined: task requires tools/,
    );
  });

  it.each([
    [[{ kind: 'teleport', input: 'x' }], /invalid kind/],
    [[{ kind: 'tool', input: 'x' }], /names no tool/],
    [[{ kind: 'generate' }], /no string input/],
    [[{ kind: 'generate', input: 'x', dependsOn: ['one'] }], /malformed dependsOn/],
  ])('refuses malformed step %j', (steps, expected) => {
    expect(() => parseModelPlan(JSON.stringify(steps))).toThrow(expected);
  });

  it('leaves undeclared mutability undefined so the engine fails closed', () => {
    const plan = parseModelPlan(JSON.stringify([{ kind: 'tool', tool: 't', input: 'x' }]));
    expect(plan.steps[0].mutating).toBeUndefined();
  });

  it('a model plan naming a forbidden tool still dies in validatePlan', () => {
    // Defence in depth: the parser shapes, the engine authorizes.
    const plan = parseModelPlan(
      JSON.stringify([{ kind: 'tool', tool: 'forbidden', input: 'x', mutating: false }]),
    );
    expect(validatePlan(plan, { allowedTools: ['other'], limits: { maxSteps: 10 } })).toMatch(
      /not permitted to call/,
    );
  });

  it('createModelPlanner sends the strict prompt and the tool list', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '[{"kind":"generate","input":"done"}]' });
    const planner = createModelPlanner(generate);

    await planner.plan({ task: 'do a thing', instructions: 'be brief', allowedTools: ['search'] });

    expect(generate.mock.calls[0][0].systemPrompt).toBe(PLANNER_SYSTEM_PROMPT);
    expect(generate.mock.calls[0][0].prompt).toContain('AVAILABLE TOOLS:\nsearch');
    expect(buildPlannerPrompt({ task: 't', instructions: 'i', allowedTools: [] })).toContain(
      '(none — generate steps only)',
    );
  });
});

describe('workspace tool-runner adapter', () => {
  beforeEach(() => {
    toolServiceMock.executeTool.mockReset();
    toolServiceMock.getExecution.mockReset();
  });

  const runner = () =>
    createWorkspaceToolRunner({
      requestedBy: 'user_1',
      maxWaitMs: 500,
      pollIntervalMs: 1,
      sleep: async () => {},
    });

  it('executes as the requesting user, through the full service path', async () => {
    toolServiceMock.executeTool.mockResolvedValue({ id: 'ex1', status: 'COMPLETED', output: 'ok' });

    const result = await runner().execute({ toolId: 't1', workspaceId: 'ws', input: 'hello' });

    // The agent borrows the requester's permissions — membership, the
    // tool:execute check, rate limits and audit all run inside this call.
    expect(toolServiceMock.executeTool).toHaveBeenCalledWith('user_1', 'ws', 't1', {
      input: { input: 'hello' },
    });
    expect(result.output).toBe('ok');
  });

  it('passes structured JSON step input straight to the tool schema', () => {
    expect(toToolInput('{"city":"Pune","units":"C"}')).toEqual({ city: 'Pune', units: 'C' });
    expect(toToolInput('plain text')).toEqual({ input: 'plain text' });
    expect(toToolInput('[1,2]')).toEqual({ input: '[1,2]' });
    expect(toToolInput('{broken json')).toEqual({ input: '{broken json' });
  });

  it('polls a RUNNING execution to its terminal state', async () => {
    toolServiceMock.executeTool.mockResolvedValue({ id: 'ex1', status: 'RUNNING' });
    toolServiceMock.getExecution
      .mockResolvedValueOnce({ id: 'ex1', status: 'RUNNING' })
      .mockResolvedValueOnce({ id: 'ex1', status: 'COMPLETED', output: { data: 42 } });

    const result = await runner().execute({ toolId: 't1', workspaceId: 'ws', input: 'x' });

    expect(result.output).toBe('{"data":42}');
    expect(toolServiceMock.getExecution).toHaveBeenCalledWith('user_1', 'ws', 'ex1');
  });

  it('fails fast on tool-level approval instead of hanging the run', async () => {
    toolServiceMock.executeTool.mockResolvedValue({ id: 'ex9', status: 'PENDING' });

    // An agent cannot wait on a human timescale; the execution id is in
    // the error so the operator can approve it in the tools surface.
    await expect(runner().execute({ toolId: 't1', workspaceId: 'ws', input: 'x' })).rejects.toThrow(
      /requires its own approval.*ex9/s,
    );
    expect(toolServiceMock.getExecution).not.toHaveBeenCalled();
  });

  it('reports a FAILED execution with the recorded error, never as success', async () => {
    toolServiceMock.executeTool.mockResolvedValue({
      id: 'ex1',
      status: 'FAILED',
      error: 'circuit breaker is open',
    });

    await expect(runner().execute({ toolId: 't1', workspaceId: 'ws', input: 'x' })).rejects.toThrow(
      /failed: circuit breaker is open/,
    );
  });

  it('gives up at the wait ceiling with the execution still identified', async () => {
    toolServiceMock.executeTool.mockResolvedValue({ id: 'ex1', status: 'RUNNING' });
    toolServiceMock.getExecution.mockResolvedValue({ id: 'ex1', status: 'RUNNING' });

    const impatient = createWorkspaceToolRunner({
      requestedBy: 'user_1',
      maxWaitMs: -1, // already past the deadline
      sleep: async () => {},
    });

    await expect(impatient.execute({ toolId: 't1', workspaceId: 'ws', input: 'x' })).rejects.toThrow(
      /did not finish within/,
    );
  });

  it('propagates permission failures from the service untouched', async () => {
    toolServiceMock.executeTool.mockRejectedValue(new Error('Insufficient permissions'));

    // The second permission layer doing its job: the agent inherits the
    // requester's limits, and a denial surfaces as a denial.
    await expect(runner().execute({ toolId: 't1', workspaceId: 'ws', input: 'x' })).rejects.toThrow(
      /Insufficient permissions/,
    );
  });
});
