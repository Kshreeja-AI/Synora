/**
 * The hard gate between Synora and an AI bill.
 *
 * Prisma is MOCKED here — these are unit tests of the guard's decision
 * logic, runnable on a machine with no database. The DB-backed properties
 * (real atomic increments, real concurrent resets) are exercised by the
 * integration tests once a database is available; nothing here pretends
 * to cover them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getConfigMock, findUniqueMock, updateManyMock, upsertMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateManyMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock('../config', () => ({ getConfig: getConfigMock }));
vi.mock('@synora/database', () => ({
  prisma: {
    aiSpendBudget: {
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
      upsert: upsertMock,
    },
  },
}));

import {
  assertAiBudget,
  recordAiSpend,
  resetGlobalSpendForTesting,
  AiBudgetExceededError,
} from './spend-guard';

function caps(ai: { globalMaxCostPerDayCents?: number; globalMaxTokensPerDay?: number }): void {
  getConfigMock.mockReturnValue({ ai });
}

/** A budget row shape as prisma would return it. */
function budgetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'b1',
    workspaceId: 'ws1',
    maxCostPerDayCents: null,
    maxCostPerMonthCents: null,
    maxTokensPerDay: null,
    usedCostTodayCents: 0,
    usedCostMonthCents: 0,
    usedTokensToday: 0,
    lastDailyResetAt: new Date(),
    lastMonthlyResetAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  resetGlobalSpendForTesting();
  getConfigMock.mockReset();
  findUniqueMock.mockReset();
  updateManyMock.mockReset();
  upsertMock.mockReset();
  caps({});
  updateManyMock.mockResolvedValue({ count: 1 });
  upsertMock.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('global caps', () => {
  it('passes freely when no cap is configured — the development default', async () => {
    await recordAiSpend({ provider: 'ollama', model: 'llama3.1', inputTokens: 1e9, outputTokens: 1e9 });
    await expect(assertAiBudget({})).resolves.toBeUndefined();
  });

  it('binds the token cap even when the model has no price — the local-model case', async () => {
    // llama3.1 is not in the pricing table, so its cost is zero forever. A
    // cost cap alone would NEVER bind it; the token cap is what bounds
    // local inference, and this test is the proof it does.
    caps({ globalMaxTokensPerDay: 1000 });
    const outcome = await recordAiSpend({
      provider: 'ollama',
      model: 'llama3.1',
      inputTokens: 600,
      outputTokens: 400,
    });
    expect(outcome.costCents).toBe(0);

    await expect(assertAiBudget({})).rejects.toMatchObject({
      scope: 'global',
      limit: 'daily-tokens',
    });
  });

  it('binds the cost cap for a priced model', async () => {
    caps({ globalMaxCostPerDayCents: 1 });
    // claude-sonnet-5 IS in the pricing table; a large call exceeds 1 cent.
    const outcome = await recordAiSpend({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      inputTokens: 10_000,
      outputTokens: 10_000,
    });
    expect(outcome.costCents).toBeGreaterThan(0);

    await expect(assertAiBudget({})).rejects.toMatchObject({
      scope: 'global',
      limit: 'daily-cost',
    });
  });

  it('applies to calls with NO workspace — a system path is not a free path', async () => {
    caps({ globalMaxTokensPerDay: 10 });
    await recordAiSpend({ provider: 'p', model: 'm', inputTokens: 20, outputTokens: 0 });
    await expect(assertAiBudget({})).rejects.toBeInstanceOf(AiBudgetExceededError);
    // And the workspace layer was never consulted for a workspace-less call.
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('rolls the window at UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T23:50:00Z'));
    caps({ globalMaxTokensPerDay: 10 });
    await recordAiSpend({ provider: 'p', model: 'm', inputTokens: 20, outputTokens: 0 });
    await expect(assertAiBudget({})).rejects.toBeInstanceOf(AiBudgetExceededError);

    vi.setSystemTime(new Date('2026-08-08T00:01:00Z'));
    await expect(assertAiBudget({})).resolves.toBeUndefined();
  });
});

describe('unknown is not zero', () => {
  it('charges the floor estimate when the provider reported NOTHING', async () => {
    const outcome = await recordAiSpend({
      provider: 'ollama',
      model: 'llama3.1',
      fallbackChars: 1000,
    });
    expect(outcome.estimated).toBe(true);
    expect(outcome.tokens).toBe(250); // ceil(1000 / 4)
  });

  it('treats a PARTIAL report as reported, not estimated', async () => {
    // One present, one absent: the provider did report. Estimating on top
    // of a real number would double-charge; zeroing the absent one is the
    // documented meaning of a partial report.
    const outcome = await recordAiSpend({
      provider: 'p',
      model: 'm',
      outputTokens: 40,
      fallbackChars: 100_000,
    });
    expect(outcome.estimated).toBe(false);
    expect(outcome.tokens).toBe(40);
  });
});

describe('workspace caps', () => {
  it('lets a workspace without a budget row run uncapped by this layer', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(assertAiBudget({ workspaceId: 'ws1' })).resolves.toBeUndefined();
  });

  it('refuses at the daily token cap, naming scope and limit', async () => {
    findUniqueMock.mockResolvedValue(budgetRow({ maxTokensPerDay: 100, usedTokensToday: 100 }));
    await expect(assertAiBudget({ workspaceId: 'ws1' })).rejects.toMatchObject({
      scope: 'workspace',
      limit: 'daily-tokens',
    });
  });

  it('refuses at the monthly cost cap', async () => {
    findUniqueMock.mockResolvedValue(
      budgetRow({ maxCostPerMonthCents: 500, usedCostMonthCents: 500 })
    );
    await expect(assertAiBudget({ workspaceId: 'ws1' })).rejects.toMatchObject({
      scope: 'workspace',
      limit: 'monthly-cost',
    });
  });

  it('a cap of zero refuses everything — distinct from "no cap set"', async () => {
    findUniqueMock.mockResolvedValue(budgetRow({ maxCostPerDayCents: 0 }));
    await expect(assertAiBudget({ workspaceId: 'ws1' })).rejects.toMatchObject({
      limit: 'daily-cost',
    });
  });

  it('lazily resets a stale daily window with a GUARDED update', async () => {
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    findUniqueMock.mockResolvedValue(
      budgetRow({
        maxTokensPerDay: 100,
        usedTokensToday: 100, // at cap — but the window is stale
        lastDailyResetAt: yesterday,
      })
    );

    // Does NOT throw: the stale window counts as zeroed.
    await expect(assertAiBudget({ workspaceId: 'ws1' })).resolves.toBeUndefined();

    // And the reset is conditional on the stored stamp, so a concurrent
    // resetter loses harmlessly instead of double-zeroing.
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lastDailyResetAt: { lt: expect.any(Date) } }),
      })
    );
  });

  it('the message tells the person when the limit resets', async () => {
    findUniqueMock.mockResolvedValue(budgetRow({ maxCostPerDayCents: 0 }));
    await expect(assertAiBudget({ workspaceId: 'ws1' })).rejects.toThrow(/midnight UTC/);
  });
});

describe('recordAiSpend durability contract', () => {
  it('never throws when the database write fails — the tokens are spent either way', async () => {
    upsertMock.mockRejectedValue(new Error('db down'));
    await expect(
      recordAiSpend({ workspaceId: 'ws1', provider: 'p', model: 'm', inputTokens: 5, outputTokens: 5 })
    ).resolves.toMatchObject({ tokens: 10 });
  });

  it('a row created by recording carries NO caps — recording never invents a limit', async () => {
    await recordAiSpend({ workspaceId: 'ws1', provider: 'p', model: 'm', inputTokens: 5, outputTokens: 5 });
    const createData = upsertMock.mock.calls[0][0].create;
    expect(createData.maxCostPerDayCents).toBeUndefined();
    expect(createData.maxCostPerMonthCents).toBeUndefined();
    expect(createData.maxTokensPerDay).toBeUndefined();
  });

  it('uses SQL-atomic increments, not read-modify-write', async () => {
    await recordAiSpend({ workspaceId: 'ws1', provider: 'p', model: 'm', inputTokens: 5, outputTokens: 5 });
    const updateData = upsertMock.mock.calls[0][0].update;
    expect(updateData.usedTokensToday).toEqual({ increment: 10 });
  });
});

/**
 * THE HOLE THIS CLOSES. `estimateCost` returned 0 for any model not in the
 * pricing table, and 0 is indistinguishable from "genuinely free". So a
 * cost cap silently stopped applying to exactly the models most likely to
 * be configured here — anything behind an OpenAI-compatible router, whose
 * names no local table can enumerate — and the deployment believed it had
 * a spending ceiling that could never trip, however much was really spent.
 *
 * Fail-closed means: if a cost cap is set and the price is unknown, refuse.
 * Nothing in here asserts a *price*; every test asserts a *decision*.
 */
describe('unknown price is fail-closed, known price is unaffected', () => {
  it('refuses a named unpriceable model BEFORE it spends anything', async () => {
    caps({ globalMaxCostPerDayCents: 500 });
    // Nothing has been recorded — the window is empty and the old code
    // would have sailed straight through, then charged 0 and never tripped.
    await expect(assertAiBudget({ model: 'some-router/mystery-7b' })).rejects.toMatchObject({
      scope: 'global',
      limit: 'daily-cost',
    });
  });

  it('says the limit cannot be HELD, not that it was reached', async () => {
    // An operator told "limit reached" goes looking at usage graphs and
    // finds nothing wrong. The distinction is the whole value of the
    // message, so it is pinned.
    caps({ globalMaxCostPerDayCents: 500 });
    await expect(assertAiBudget({ model: 'mystery-7b' })).rejects.toThrow(
      /no price for the model/i
    );
    await expect(assertAiBudget({ model: 'mystery-7b' })).rejects.toThrow(
      /add a price for the model, or remove the cost limit/i
    );
  });

  it('lets a PRICED model through the same cap — no false refusal', async () => {
    caps({ globalMaxCostPerDayCents: 500 });
    await expect(assertAiBudget({ model: 'claude-sonnet-5' })).resolves.toBeUndefined();
  });

  it('does NOT refuse an unpriceable model when no cost cap was ever asked for', async () => {
    // The local-model case, and the reason this is not simply "block
    // unknown models". A deployment running its own model has no per-token
    // price by definition; refusing it would break self-hosting to enforce
    // a ceiling nobody set.
    caps({});
    await expect(assertAiBudget({ model: 'llama3.1' })).resolves.toBeUndefined();
    await recordAiSpend({ provider: 'ollama', model: 'llama3.1', inputTokens: 9_000, outputTokens: 9_000 });
    await expect(assertAiBudget({ model: 'llama3.1' })).resolves.toBeUndefined();
  });

  it('leaves the TOKEN cap fully enforcing for an unpriceable model', async () => {
    // Tokens are counted without needing a price, so the token cap is the
    // one that genuinely bounds local inference. Fail-closed on cost must
    // not have quietly swapped one working cap for one refusal.
    caps({ globalMaxTokensPerDay: 1000 });
    await expect(assertAiBudget({ model: 'llama3.1' })).resolves.toBeUndefined();
    await recordAiSpend({ provider: 'ollama', model: 'llama3.1', inputTokens: 600, outputTokens: 500 });
    await expect(assertAiBudget({ model: 'llama3.1' })).rejects.toMatchObject({
      limit: 'daily-tokens',
    });
  });

  it('reports priceKnown so a total can never silently omit real spend', async () => {
    const unpriced = await recordAiSpend({
      provider: 'self-hosted', model: 'mystery-7b', inputTokens: 1000, outputTokens: 1000,
    });
    expect(unpriced.priceKnown).toBe(false);
    expect(unpriced.costCents).toBe(0); // zero because unknown, NOT because free

    const priced = await recordAiSpend({
      provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 1000, outputTokens: 1000,
    });
    expect(priced.priceKnown).toBe(true);
    expect(priced.costCents).toBeGreaterThan(0);
  });
});

/**
 * The half a pre-flight check cannot cover. The authoritative model name is
 * whatever the provider says it used, known only AFTER the call: a caller
 * may name no model at all (letting the provider pick its default), or name
 * an alias the provider resolves server-side to something else.
 */
describe('unknown price discovered after the fact', () => {
  it('refuses every later call once an unpriceable model has actually spent', async () => {
    caps({ globalMaxCostPerDayCents: 500 });

    // Call one: the caller cannot name the model, so nothing refuses it.
    await expect(assertAiBudget({})).resolves.toBeUndefined();
    await recordAiSpend({ provider: 'self-hosted', model: 'router/whatever', inputTokens: 10, outputTokens: 10 });

    // Call two onwards: the fact is now known, and the cap is honest about
    // being unenforceable rather than sitting at a comfortable zero.
    await expect(assertAiBudget({})).rejects.toMatchObject({
      scope: 'global',
      limit: 'daily-cost',
    });
  });

  it('does NOT forget at midnight — a new day does not make a model priceable', async () => {
    // THE PROPERTY THAT MATTERS MOST HERE. The cost/token counters roll at
    // UTC midnight because a budget is a per-window quantity. This is not a
    // quantity, and rolling it would re-open the hole every single day —
    // one silent unpriced call per day, forever, which is precisely the
    // shape of bug this module exists to prevent.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T23:50:00Z'));
    caps({ globalMaxCostPerDayCents: 500 });

    await recordAiSpend({ provider: 'self-hosted', model: 'router/whatever', inputTokens: 10, outputTokens: 10 });
    await expect(assertAiBudget({})).rejects.toBeInstanceOf(AiBudgetExceededError);

    vi.setSystemTime(new Date('2026-08-08T00:01:00Z'));
    await expect(assertAiBudget({})).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it('stays quiet when the deployment never asked for a cost ceiling', async () => {
    caps({});
    await recordAiSpend({ provider: 'ollama', model: 'llama3.1', inputTokens: 10, outputTokens: 10 });
    await expect(assertAiBudget({})).resolves.toBeUndefined();
  });
});

describe('unknown price at workspace scope', () => {
  it('refuses when the workspace has a cost cap it could not hold', async () => {
    caps({}); // no global cap — proves the workspace layer refuses on its own
    findUniqueMock.mockResolvedValue(budgetRow({ maxCostPerDayCents: 1000 }));
    await expect(
      assertAiBudget({ workspaceId: 'ws1', model: 'mystery-7b' })
    ).rejects.toMatchObject({ scope: 'workspace', limit: 'daily-cost' });
  });

  it('reports monthly-cost when that is the cap actually set', async () => {
    caps({});
    findUniqueMock.mockResolvedValue(budgetRow({ maxCostPerMonthCents: 1000 }));
    await expect(
      assertAiBudget({ workspaceId: 'ws1', model: 'mystery-7b' })
    ).rejects.toMatchObject({ scope: 'workspace', limit: 'monthly-cost' });
  });

  it('does NOT refuse a workspace whose only cap is on tokens', async () => {
    // A token cap is not broken by a missing price — it is still fully
    // enforced — so refusing here would deny a workspace a limit it never
    // exceeded.
    caps({});
    findUniqueMock.mockResolvedValue(budgetRow({ maxTokensPerDay: 100_000 }));
    await expect(
      assertAiBudget({ workspaceId: 'ws1', model: 'mystery-7b' })
    ).resolves.toBeUndefined();
  });

  it('never punishes one workspace for another workspace\'s unpriced spend', async () => {
    // The global cap is deployment-wide, so any unpriced spend anywhere
    // breaks it. A workspace cap is not, and blaming a neighbour would be
    // a limit this workspace never hit.
    caps({});
    await recordAiSpend({
      workspaceId: 'wsA', provider: 'self-hosted', model: 'router/whatever',
      inputTokens: 10, outputTokens: 10,
    });

    findUniqueMock.mockResolvedValue(budgetRow({ workspaceId: 'wsB', maxCostPerDayCents: 1000 }));
    await expect(assertAiBudget({ workspaceId: 'wsB' })).resolves.toBeUndefined();

    findUniqueMock.mockResolvedValue(budgetRow({ workspaceId: 'wsA', maxCostPerDayCents: 1000 }));
    await expect(assertAiBudget({ workspaceId: 'wsA' })).rejects.toMatchObject({
      scope: 'workspace',
    });
  });
});
