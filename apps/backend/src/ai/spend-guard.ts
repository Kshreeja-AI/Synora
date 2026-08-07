import { prisma } from '@synora/database';
import { getConfig } from '../config';
import { estimateCost } from './pricing';
import { logger } from '../utils/logger';

/**
 * The hard gate between Synora and an AI bill.
 *
 * Cost was already OBSERVED everywhere — pricing tables, the EOS cost
 * monitor, per-call instrumentation — and STOPPED nowhere. This module is
 * the stop. It ships before any metered credential is connected, because
 * an uncapped key in a public-facing application is an unbounded
 * liability, and the order of those two events is a policy, not an
 * accident.
 *
 * TWO LAYERS, INDEPENDENTLY BINDING:
 *  - Global (process-wide, from env config): the deployment's kill switch.
 *    Applies to every call, even ones with no workspace (system judges,
 *    unscoped API use). Absent means no global cap — the dev default.
 *  - Per-workspace (AiSpendBudget row): a workspace WITHOUT a row runs
 *    uncapped by this layer, mirroring `agents/metering.ts`'s "a workspace
 *    without a credits account has not opted into billing" rule.
 *
 * TOKENS AND CENTS ARE SEPARATE CAPS on purpose. Locally-served models
 * (Ollama, self-hosted) have no per-token price, so their cost is zero
 * forever and a cost cap never binds them; the token cap is what bounds
 * local inference. Conversely a hosted model's dollars are what hurt, and
 * `maxTokensPerDay` may legitimately be unset there.
 *
 * UNKNOWN IS NOT ZERO. `recordAiSpend` takes the provider's token counts
 * as raw optionals — never pre-coerced with `?? 0` — and when BOTH are
 * absent it charges a floor estimate (`ceil(chars / 4)`) marked
 * `estimated: true`. The OpenAI-compatible self-hosted path is exactly
 * where usage goes missing, and a guard that counted "unreported" as
 * "free" would leak precisely where it matters most.
 *
 * CHECK-THEN-RECORD, NOT A TRANSACTION. `assertAiBudget` runs before the
 * generation; `recordAiSpend` after. In-flight requests can each overshoot
 * the cap by one call — accepted and documented, because killing a
 * completed generation retroactively wastes the very spend being
 * protected (the same reasoning as `agents/metering.ts`). Increments are
 * SQL-atomic (`{ increment }`), so nothing is ever lost or double-counted;
 * resets are conditional updates keyed on the stored stamp, so two
 * concurrent resets cannot both zero a window.
 *
 * `recordAiSpend` NEVER THROWS. Accounting failure must not fail a
 * generation that already happened — the tokens are spent either way, and
 * an error here would invite a retry that spends them again.
 */

export type SpendScope = 'workspace' | 'global';
export type SpendLimit = 'daily-cost' | 'monthly-cost' | 'daily-tokens';

export class AiBudgetExceededError extends Error {
  constructor(
    readonly scope: SpendScope,
    readonly limit: SpendLimit,
    message: string
  ) {
    super(message);
    this.name = 'AiBudgetExceededError';
  }
}

/** UTC-midnight boundary of the moment given. Windows are UTC, no TZ math. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The process-wide counter. In-process on purpose: the global cap is a
 * deployment kill switch, and a per-instance bucket that admits N× the
 * cap across N instances still stops a runaway loop on every one of
 * them — while needing no shared infrastructure to work. Multi-instance
 * exactness belongs to the per-workspace DB layer.
 */
let globalWindow = { dayKeyUtc: '', costCents: 0, tokens: 0 };

function globalDayKey(now: Date): string {
  return startOfUtcDay(now).toISOString();
}

function rolledGlobalWindow(now: Date): typeof globalWindow {
  const key = globalDayKey(now);
  if (globalWindow.dayKeyUtc !== key) {
    globalWindow = { dayKeyUtc: key, costCents: 0, tokens: 0 };
  }
  return globalWindow;
}

/** Test seam — the global window survives between tests otherwise. */
export function resetGlobalSpendForTesting(): void {
  globalWindow = { dayKeyUtc: '', costCents: 0, tokens: 0 };
}

const budgetMessage = (scope: SpendScope, limit: SpendLimit): string =>
  scope === 'workspace'
    ? `This workspace's AI ${limit === 'daily-tokens' ? 'usage' : 'spending'} limit for ${
        limit === 'monthly-cost' ? 'this month' : 'today'
      } is used up. Nothing was generated. ${
        limit === 'monthly-cost'
          ? 'The limit resets on the 1st (UTC).'
          : 'The limit resets at midnight UTC.'
      }`
    : 'This deployment has reached its AI usage limit for today, so nothing was generated. The limit resets at midnight UTC.';

/**
 * Refuse BEFORE any generation runs, or return quietly.
 *
 * Calls without a workspace are still bound by the global caps — a system
 * path is not a free path — they simply have no per-workspace row to bind
 * them.
 */
/**
 * The global caps live in config, so an unreadable config IS "no global
 * caps configured" — not an enforcement failure to hide. In production the
 * server initializes config before serving anything; the uninitialized
 * case exists only at boot and in unit tests, where throwing here would
 * make the guard fail every caller for a reason that has nothing to do
 * with budgets. The per-workspace layer does not depend on config at all.
 */
function globalCaps(): { globalMaxCostPerDayCents?: number; globalMaxTokensPerDay?: number } {
  try {
    const { globalMaxCostPerDayCents, globalMaxTokensPerDay } = getConfig().ai;
    return { globalMaxCostPerDayCents, globalMaxTokensPerDay };
  } catch {
    return {};
  }
}

export async function assertAiBudget(check: { workspaceId?: string }): Promise<void> {
  const now = new Date();
  const { globalMaxCostPerDayCents, globalMaxTokensPerDay } = globalCaps();

  const window = rolledGlobalWindow(now);
  if (globalMaxCostPerDayCents !== undefined && window.costCents >= globalMaxCostPerDayCents) {
    throw new AiBudgetExceededError('global', 'daily-cost', budgetMessage('global', 'daily-cost'));
  }
  if (globalMaxTokensPerDay !== undefined && window.tokens >= globalMaxTokensPerDay) {
    throw new AiBudgetExceededError('global', 'daily-tokens', budgetMessage('global', 'daily-tokens'));
  }

  if (!check.workspaceId) return;

  const budget = await prisma.aiSpendBudget.findUnique({
    where: { workspaceId: check.workspaceId },
  });
  // No row = not opted into workspace capping. The global layer above
  // still applied. Same shape as agents/metering.ts's assertRunBudget.
  if (!budget) return;

  // Lazy conditional resets: keyed on the STORED stamp so two concurrent
  // callers cannot both zero a window (the loser's updateMany matches 0
  // rows). Converge-on-access, like approval expiry — no sweeper job to
  // be down.
  const dayStart = startOfUtcDay(now);
  const monthStart = startOfUtcMonth(now);
  if (budget.lastDailyResetAt < dayStart) {
    await prisma.aiSpendBudget.updateMany({
      where: { workspaceId: check.workspaceId, lastDailyResetAt: { lt: dayStart } },
      data: { usedCostTodayCents: 0, usedTokensToday: 0, lastDailyResetAt: now },
    });
    budget.usedCostTodayCents = 0;
    budget.usedTokensToday = 0;
  }
  if (budget.lastMonthlyResetAt < monthStart) {
    await prisma.aiSpendBudget.updateMany({
      where: { workspaceId: check.workspaceId, lastMonthlyResetAt: { lt: monthStart } },
      data: { usedCostMonthCents: 0, lastMonthlyResetAt: now },
    });
    budget.usedCostMonthCents = 0;
  }

  if (
    budget.maxCostPerDayCents !== null &&
    budget.usedCostTodayCents >= budget.maxCostPerDayCents
  ) {
    throw new AiBudgetExceededError('workspace', 'daily-cost', budgetMessage('workspace', 'daily-cost'));
  }
  if (
    budget.maxCostPerMonthCents !== null &&
    budget.usedCostMonthCents >= budget.maxCostPerMonthCents
  ) {
    throw new AiBudgetExceededError('workspace', 'monthly-cost', budgetMessage('workspace', 'monthly-cost'));
  }
  if (budget.maxTokensPerDay !== null && budget.usedTokensToday >= budget.maxTokensPerDay) {
    throw new AiBudgetExceededError('workspace', 'daily-tokens', budgetMessage('workspace', 'daily-tokens'));
  }
}

export interface AiSpendRecord {
  workspaceId?: string;
  provider: string;
  model: string;
  /**
   * RAW provider-reported counts. Pass exactly what the provider said —
   * `undefined` when it said nothing. Pre-coercing with `?? 0` here is the
   * bug this module exists to prevent: unknown must stay distinguishable
   * from free.
   */
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt + output character count, for the floor estimate. */
  fallbackChars?: number;
}

export interface AiSpendOutcome {
  tokens: number;
  costCents: number;
  /** True when the provider reported nothing and the floor estimate was charged. */
  estimated: boolean;
}

/**
 * Charge the spend that just happened. Best-effort by contract: the
 * generation is already done, so failure here is logged, never thrown.
 */
export async function recordAiSpend(record: AiSpendRecord): Promise<AiSpendOutcome> {
  const estimated = record.inputTokens === undefined && record.outputTokens === undefined;
  const tokens = estimated
    ? Math.ceil((record.fallbackChars ?? 0) / 4)
    : (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
  const costUsd = estimateCost(
    record.model,
    record.inputTokens ?? (estimated ? tokens : 0),
    record.outputTokens ?? 0
  );
  const costCents = Math.ceil(costUsd * 100);

  const now = new Date();
  const window = rolledGlobalWindow(now);
  window.costCents += costCents;
  window.tokens += tokens;

  if (record.workspaceId) {
    try {
      // Upsert-then-increment keeps the increment SQL-atomic. A row created
      // here carries NO caps — recording spend must never invent a limit
      // the workspace did not set.
      await prisma.aiSpendBudget.upsert({
        where: { workspaceId: record.workspaceId },
        create: {
          workspaceId: record.workspaceId,
          usedCostTodayCents: costCents,
          usedCostMonthCents: costCents,
          usedTokensToday: tokens,
        },
        update: {
          usedCostTodayCents: { increment: costCents },
          usedCostMonthCents: { increment: costCents },
          usedTokensToday: { increment: tokens },
        },
      });
    } catch (error) {
      logger.error('[SpendGuard] Failed to record AI spend — accounting is behind by one call', {
        workspaceId: record.workspaceId,
        provider: record.provider,
        model: record.model,
        tokens,
        costCents,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { tokens, costCents, estimated };
}
