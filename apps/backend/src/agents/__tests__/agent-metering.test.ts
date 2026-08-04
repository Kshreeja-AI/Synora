/**
 * Metering tests.
 *
 * Two accounting rules are under test. Usage is always counted even when
 * deduction cannot happen — a usage history that loses records whenever
 * billing hiccups lies by omission. And deterministic generate-steps cost
 * zero, because no tokens were bought and charging for them would
 * fabricate a cost that never existed; tool calls are charged regardless,
 * because a tool does real work whatever planned it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordUsage = vi.hoisted(() => vi.fn());
const usageRecordCreate = vi.hoisted(() => vi.fn());
const creditsFindUnique = vi.hoisted(() => vi.fn());

vi.mock('../../services/credit.service.js', () => ({
  recordUsage,
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock('@synora/database', () => ({
  prisma: {
    usageRecord: { create: usageRecordCreate },
    workspaceCredits: { findUnique: creditsFindUnique },
  },
}));

import {
  assertRunBudget,
  BudgetExceededError,
  computeRunUsage,
  meterRun,
  resetMetering,
  RUN_PRICING,
} from '../metering';
import type { AgentRun, StepRecord } from '../types';

function step(kind: 'generate' | 'tool', attempts = 1): StepRecord {
  return {
    step: {
      id: 's1',
      kind,
      description: 'x',
      input: 'x',
      ...(kind === 'tool' ? { toolId: 'echo' } : {}),
    },
    state: attempts > 0 ? 'succeeded' : 'pending',
    attempts,
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: `run_${Math.random().toString(36).slice(2)}`,
    agentId: 'agent_1',
    agentVersion: 1,
    lineageId: 'lin_1',
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 't',
    state: 'completed',
    plan: { steps: [], origin: 'model' },
    steps: [step('generate'), step('tool')],
    toolCallsUsed: 1,
    log: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  resetMetering();
  recordUsage.mockReset().mockResolvedValue(undefined);
  usageRecordCreate.mockReset().mockResolvedValue({ id: 'ur_1' });
  creditsFindUnique.mockReset().mockResolvedValue(null);
});

describe('the pre-run budget gate', () => {
  it('lets a workspace with no credits account run freely', async () => {
    // Every local workspace. Matches the metering rule: count, don't
    // deduct — and here, don't block.
    creditsFindUnique.mockResolvedValue(null);
    await expect(assertRunBudget('ws_1')).resolves.toBeUndefined();
  });

  it('refuses a run when an opted-in workspace has no balance', async () => {
    // Opting into billing means the budget binds — refused BEFORE
    // anything executes, not discovered at deduction time.
    creditsFindUnique.mockResolvedValue({ workspaceId: 'ws_1', balance: 0 });
    await expect(assertRunBudget('ws_1')).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('lets a positive balance through', async () => {
    creditsFindUnique.mockResolvedValue({ workspaceId: 'ws_1', balance: 5 });
    await expect(assertRunBudget('ws_1')).resolves.toBeUndefined();
  });
});

describe('computing run usage', () => {
  it('counts only steps that actually executed, not plan size', () => {
    const usage = computeRunUsage(
      makeRun({ steps: [step('generate'), step('generate', 0)], toolCallsUsed: 0 }),
    );
    // The second generate never ran (attempts=0): a refused or skipped
    // step consumed nothing and is not billed.
    expect(usage.generateSteps).toBe(1);
  });

  it('charges model generate-steps and tool calls', () => {
    const usage = computeRunUsage(makeRun());
    expect(usage.creditsCost).toBe(RUN_PRICING.modelGenerateStep + RUN_PRICING.toolCall);
  });

  it('charges zero for deterministic generate-steps but still counts them', () => {
    const usage = computeRunUsage(
      makeRun({
        plan: { steps: [], origin: 'local-deterministic' },
        steps: [step('generate')],
        toolCallsUsed: 0,
      }),
    );
    // No tokens were bought; charging would fabricate a cost. The QUANTITY
    // is still real and still counted.
    expect(usage.generateSteps).toBe(1);
    expect(usage.creditsCost).toBe(0);
  });

  it('charges tool calls regardless of plan origin', () => {
    const usage = computeRunUsage(
      makeRun({
        plan: { steps: [], origin: 'local-deterministic' },
        steps: [step('tool')],
        toolCallsUsed: 1,
      }),
    );
    expect(usage.creditsCost).toBe(RUN_PRICING.toolCall);
  });
});

describe('metering a terminal run', () => {
  it('deducts through the credit service when the run has a cost', async () => {
    const outcome = await meterRun({ run: makeRun(), capability: 'agent-run' });

    expect(outcome).toEqual({ recorded: true, creditsCost: 2, deducted: true });
    expect(recordUsage).toHaveBeenCalledWith(
      'ws_1',
      expect.objectContaining({ capability: 'agent-run', creditsCost: 2, userId: 'u1' }),
    );
  });

  it('still counts usage when the workspace has no credits account', async () => {
    recordUsage.mockRejectedValue(new Error('Workspace credits not found'));

    const outcome = await meterRun({ run: makeRun(), capability: 'agent-run' });

    // The deduction failed; the usage still happened. Losing the record
    // would make history lie by omission, so it is written without a
    // deduction and says so.
    expect(outcome.recorded).toBe(true);
    expect(outcome.deducted).toBe(false);
    const written = usageRecordCreate.mock.calls[0][0].data;
    expect(written.creditsCost).toBe(2);
    expect(written.metadata.deducted).toBe(false);
    expect(written.metadata.reason).toBe('no-credits-account');
  });

  it('records a zero-cost deterministic run as counted, not billed', async () => {
    const outcome = await meterRun({
      run: makeRun({
        plan: { steps: [], origin: 'local-deterministic' },
        steps: [step('generate')],
        toolCallsUsed: 0,
      }),
      capability: 'agent-run',
    });

    expect(outcome).toEqual({ recorded: true, creditsCost: 0, deducted: false });
    expect(recordUsage).not.toHaveBeenCalled();
    expect(usageRecordCreate.mock.calls[0][0].data.metadata.reason).toBe('zero-cost');
  });

  it('writes no ledger line for a run that executed nothing', async () => {
    const outcome = await meterRun({
      run: makeRun({ state: 'failed', steps: [], toolCallsUsed: 0 }),
      capability: 'agent-run',
    });

    // A refused plan or a pre-execution cancel consumed nothing.
    expect(outcome.recorded).toBe(false);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(usageRecordCreate).not.toHaveBeenCalled();
  });

  it('meters one run at most once', async () => {
    const run = makeRun();
    await meterRun({ run, capability: 'agent-run' });
    const second = await meterRun({ run, capability: 'agent-run' });

    expect(second.recorded).toBe(false);
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when every write fails', async () => {
    recordUsage.mockRejectedValue(new Error('down'));
    usageRecordCreate.mockRejectedValue(new Error('also down'));

    // A completed run must not be reported failed because accounting
    // hiccuped.
    const outcome = await meterRun({ run: makeRun(), capability: 'agent-run' });
    expect(outcome.recorded).toBe(false);
  });

  it('bills a partially-executed run for what actually ran', async () => {
    const outcome = await meterRun({
      run: makeRun({
        state: 'cancelled',
        steps: [step('tool'), step('generate', 0)],
        toolCallsUsed: 1,
      }),
      capability: 'agent-run',
    });

    // Rejected after one tool call: that call did real work and is
    // billed; the never-executed generate step is not.
    expect(outcome.creditsCost).toBe(RUN_PRICING.toolCall);
  });
});
