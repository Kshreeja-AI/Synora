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

const { getConfigMock, findUniqueMock, updateManyMock, upsertMock, globalDays, redisStore } =
  vi.hoisted(() => ({
    getConfigMock: vi.fn(),
    findUniqueMock: vi.fn(),
    updateManyMock: vi.fn(),
    upsertMock: vi.fn(),
    // The deployment-wide ledger now lives in Postgres, so the mock models
    // it faithfully — a real keyed store with real increments — rather than
    // stubbing it away. A stub that always returned zero would make every
    // global-cap test vacuous.
    globalDays: new Map<string, { costCents: number; tokens: number }>(),
    redisStore: new Map<string, number>(),
  }));

vi.mock('../config', () => ({ getConfig: getConfigMock }));
vi.mock('@synora/database', () => ({
  prisma: {
    aiSpendBudget: {
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
      upsert: upsertMock,
    },
    aiGlobalSpendDay: {
      findUnique: async ({ where }: { where: { dayUtc: string } }) =>
        globalDays.get(where.dayUtc) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { dayUtc: string };
        create: { costCents: number; tokens: number };
        update: { costCents: { increment: number }; tokens: { increment: number } };
      }) => {
        const existing = globalDays.get(where.dayUtc);
        if (!existing) {
          globalDays.set(where.dayUtc, { costCents: create.costCents, tokens: create.tokens });
        } else {
          existing.costCents += update.costCents.increment;
          existing.tokens += update.tokens.increment;
        }
        return globalDays.get(where.dayUtc);
      },
    },
  },
}));

// Redis backs the per-user ceiling. Modelled, not stubbed, for the same
// reason as the ledger above.
vi.mock('../queue/redis', () => ({
  getRedisConnection: () => ({
    get: async (key: string) => {
      const value = redisStore.get(key);
      return value === undefined ? null : String(value);
    },
    incrby: async (key: string, by: number) => {
      const next = (redisStore.get(key) ?? 0) + by;
      redisStore.set(key, next);
      return next;
    },
    expire: async () => 1,
  }),
}));

import {
  assertAiBudget,
  recordAiSpend,
  resetGlobalSpendForTesting,
  AiBudgetExceededError,
} from './spend-guard';

function caps(ai: {
  globalMaxCostPerDayCents?: number;
  globalMaxTokensPerDay?: number;
  userMaxCostPerDayCents?: number;
}): void {
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
  globalDays.clear();
  redisStore.clear();
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
 * THE HOLE THIS SLICE CLOSES.
 *
 * Cost used to come straight from `estimateCost`, which returns 0 for any
 * model missing from the price table. A dollar cap therefore never bound an
 * unpriced model — and `ANTHROPIC_MODEL` is free-form env configuration, so
 * an ordinary value like a dated snapshot is not a table key. Someone who
 * set a $5/day cap and a real model name had no cap at all.
 *
 * "Free because it runs on my own hardware" and "free because nobody has
 * priced it" are indistinguishable to arithmetic and opposite to a bill.
 * The provider now declares which it is.
 */
describe('unpriced models cannot silently bypass a cost cap', () => {
  // A realistic value, not a contrived one: this is exactly what a dated
  // Anthropic snapshot looks like, and it is not a key in MODEL_PRICING.
  const DATED_SNAPSHOT = 'claude-sonnet-5-20250514';

  it('CHARGES a metered provider whose model is not in the price table', async () => {
    const outcome = await recordAiSpend({
      provider: 'anthropic',
      model: DATED_SNAPSHOT,
      inputTokens: 10_000,
      outputTokens: 10_000,
    });

    // Before the fix this was 0 — the entire defect in one assertion.
    expect(outcome.costCents).toBeGreaterThan(0);
    // And it says the number is a ceiling, not a real price, so an operator
    // can add the missing entry instead of trusting an estimate forever.
    expect(outcome.unpricedModel).toBe(true);
  });

  it('lets a cost cap actually bind an unpriced metered model', async () => {
    // The end-to-end exploit: cap the dollars (the natural thing to do),
    // leave the token cap unset, and use a model nobody priced.
    caps({ globalMaxCostPerDayCents: 5 });

    await recordAiSpend({
      provider: 'anthropic',
      model: DATED_SNAPSHOT,
      inputTokens: 50_000,
      outputTokens: 50_000,
    });

    await expect(assertAiBudget({})).rejects.toMatchObject({
      scope: 'global',
      limit: 'daily-cost',
    });
  });

  it('charges AT LEAST the priciest known rate, never less', async () => {
    // The ceiling is derived from the table's maximum, so it cannot be
    // cheaper than a model we do know — otherwise "unknown" would still be
    // the cheapest way to spend money.
    const unpriced = await recordAiSpend({
      provider: 'anthropic',
      model: DATED_SNAPSHOT,
      inputTokens: 10_000,
      outputTokens: 10_000,
    });
    resetGlobalSpendForTesting();
    const priciestKnown = await recordAiSpend({
      provider: 'anthropic',
      model: 'claude-opus-4',
      inputTokens: 10_000,
      outputTokens: 10_000,
    });

    expect(unpriced.costCents).toBeGreaterThanOrEqual(priciestKnown.costCents);
  });

  it('treats an UNRECOGNIZED provider as metered — unknown is not free', async () => {
    // A provider id this build cannot identify is not evidence that it
    // costs nothing. Failing closed here is what stops a future provider
    // from arriving uncapped.
    const outcome = await recordAiSpend({
      provider: 'some-provider-this-build-does-not-know',
      model: 'some-model',
      inputTokens: 10_000,
      outputTokens: 10_000,
    });

    expect(outcome.costCents).toBeGreaterThan(0);
    expect(outcome.unpricedModel).toBe(true);
  });

  it('keeps a DECLARED-unmetered provider genuinely free, and still counts its tokens', async () => {
    // Ollama costs nothing per token and must stay that way, or local-first
    // operation would be throttled by a bill that does not exist. It is
    // free because the provider DECLARES it, not because its model is
    // missing from a table — the distinction the fix turns on.
    const outcome = await recordAiSpend({
      provider: 'ollama',
      model: DATED_SNAPSHOT, // deliberately unpriced: still free, because declared
      inputTokens: 500_000,
      outputTokens: 500_000,
    });

    expect(outcome.costCents).toBe(0);
    expect(outcome.unpricedModel).toBe(false);
    // Tokens still accrue, so the TOKEN cap remains the control that bounds
    // local inference.
    expect(outcome.tokens).toBe(1_000_000);
  });

  it('does not let a cost cap throttle local inference', async () => {
    caps({ globalMaxCostPerDayCents: 1 });
    await recordAiSpend({
      provider: 'ollama',
      model: 'llama3.1',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // A dollar cap must never bind a provider that spends no dollars.
    await expect(assertAiBudget({})).resolves.toBeUndefined();
  });
});

/**
 * The controls that must hold across INSTANCES and RESTARTS.
 *
 * The global counter used to be a module variable. Three instances each
 * admitted the full cap, and a restart forgot the day's spend — so a crash
 * loop reset the budget every time. A financial control cannot live in
 * process memory, and these tests are what say so executably.
 */
describe('durable, multi-instance controls', () => {
  it('survives a process restart — spend is not forgotten', async () => {
    caps({ globalMaxCostPerDayCents: 10 });
    await recordAiSpend({
      provider: 'anthropic',
      model: 'claude-opus-4',
      inputTokens: 20_000,
      outputTokens: 20_000,
    });

    // Simulate the process dying and coming back: every in-memory cache is
    // gone, and only the durable ledger remains.
    resetGlobalSpendForTesting();

    await expect(assertAiBudget({})).rejects.toMatchObject({
      scope: 'global',
      limit: 'daily-cost',
    });
  });

  it('shares one budget across instances rather than one each', async () => {
    caps({ globalMaxCostPerDayCents: 10 });
    // "Instance A" spends.
    await recordAiSpend({
      provider: 'anthropic',
      model: 'claude-opus-4',
      inputTokens: 20_000,
      outputTokens: 20_000,
    });
    // "Instance B" has its own empty cache but reads the same ledger.
    resetGlobalSpendForTesting();
    await expect(assertAiBudget({})).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it('does not read the ledger at all when no global cap is configured', async () => {
    // An uncapped development deployment must not pay a database round-trip
    // on every single AI call.
    caps({});
    await expect(assertAiBudget({})).resolves.toBeUndefined();
    expect(globalDays.size).toBe(0);
  });
});

describe('per-user ceiling', () => {
  it('stops one user draining a shared workspace budget', async () => {
    caps({ userMaxCostPerDayCents: 50 });
    await recordAiSpend({
      userId: 'user-1',
      provider: 'anthropic',
      model: 'claude-opus-4',
      inputTokens: 50_000,
      outputTokens: 50_000,
    });

    await expect(assertAiBudget({ userId: 'user-1' })).rejects.toMatchObject({
      scope: 'user',
      limit: 'daily-cost',
    });
    // A DIFFERENT user is unaffected — it is a per-user ceiling, not a
    // shared bucket that one person's usage closes for everyone.
    await expect(assertAiBudget({ userId: 'user-2' })).resolves.toBeUndefined();
  });

  it('is skipped when the path cannot say who is asking', async () => {
    // Applying a per-user cap to "unknown user" would pool every anonymous
    // system call into one bucket and refuse them together.
    caps({ userMaxCostPerDayCents: 1 });
    await recordAiSpend({
      provider: 'anthropic',
      model: 'claude-opus-4',
      inputTokens: 50_000,
      outputTokens: 50_000,
    });
    await expect(assertAiBudget({})).resolves.toBeUndefined();
  });
});

describe('caller-computed cost — workloads this module cannot price', () => {
  it('uses the caller price instead of text-token rates', async () => {
    // An embedding priced by its OWN table. Text rates would charge
    // 100–1000× this and refuse workspaces on a fantasy number.
    const outcome = await recordAiSpend({
      provider: 'voyage',
      model: 'voyage-3',
      inputTokens: 100_000,
      knownCostCents: 1,
    });
    expect(outcome.costCents).toBe(1);
    expect(outcome.unpricedModel).toBe(false);
  });

  it('accepts an explicit zero as a real price, distinct from absent', async () => {
    // A provider's genuinely free tier, priced as an explicit 0 by the
    // caller's table — not the same thing as "nobody priced it".
    const outcome = await recordAiSpend({
      provider: 'gemini',
      model: 'text-embedding-004',
      inputTokens: 100_000,
      knownCostCents: 0,
    });
    expect(outcome.costCents).toBe(0);
    expect(outcome.unpricedModel).toBe(false);
  });

  it('still counts caller-priced spend against the global cap', async () => {
    caps({ globalMaxCostPerDayCents: 5 });
    await recordAiSpend({
      provider: 'replicate',
      model: 'some-video-model',
      knownCostCents: 500,
    });
    await expect(assertAiBudget({})).rejects.toMatchObject({ scope: 'global' });
  });
});
