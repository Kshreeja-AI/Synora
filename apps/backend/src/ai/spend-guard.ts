import { prisma } from '@synora/database';
import { getConfig } from '../config';
import { estimateCostOrUnknown, isPriceKnown } from './pricing';
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
 * AND AN UNKNOWN PRICE IS NOT ZERO EITHER. The same rule, one level up.
 * A model this deployment cannot price used to score 0 cents per call, so
 * a cost cap simply never tripped for it — silently, and specifically for
 * the models most likely to be configured here: anything behind an
 * OpenAI-compatible router, whose names no local table can enumerate. A
 * cost cap is a promise that spending stops at a number, and that promise
 * cannot be kept for a model with no price. So when a cost cap is set and
 * the price is unknown, this module REFUSES rather than pretending. See
 * `unpricedModels` below for how a price that only becomes knowable after
 * the call is handled.
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

/**
 * Models this process has actually spent on and cannot price, plus the
 * workspaces that spent on them.
 *
 * WHY THIS EXISTS AT ALL. The authoritative model name is the one the
 * provider says it used, and that is only known AFTER the call returns —
 * a caller may pass no model (letting the provider choose its default), or
 * pass an alias the provider resolves server-side to something else. So a
 * pre-flight check on the requested name cannot be complete on its own.
 * This is the other half: the first unpriceable call is remembered, and
 * every call after it is refused while a cost cap is set.
 *
 * ONE CALL CAN THEREFORE SLIP THROUGH before the fact is known. That is
 * the same single-call overshoot the check-then-record design already
 * accepts and documents above, for the same reason — the alternative is
 * pre-flighting information that does not exist yet.
 *
 * WHY THESE ARE NOT PART OF THE DAILY WINDOW. The counters above roll at
 * UTC midnight because a budget is a per-window quantity. This is not a
 * quantity; it is the standing fact that a cost cap here cannot be
 * honoured, and midnight does not make an unpriceable model priceable.
 * Rolling it would quietly re-open the hole every single day — the exact
 * failure shape this module exists to prevent. Clearing it needs a real
 * change: add a price for the model, or drop the cost cap. Both are
 * configuration, configuration is read at boot, so a restart clears this
 * and nothing else does. That is the intended escape, not an oversight.
 *
 * KEPT SEPARATE, GLOBAL FROM WORKSPACE, on purpose. The global cap is
 * deployment-wide, so any unpriceable spend anywhere breaks it. A
 * workspace cap is not: refusing workspace B because workspace A ran an
 * unpriceable model would be a limit B never hit.
 */
let unpricedModels = new Set<string>();
let unpricedWorkspaces = new Set<string>();

/** Test seam — the global window survives between tests otherwise. */
export function resetGlobalSpendForTesting(): void {
  globalWindow = { dayKeyUtc: '', costCents: 0, tokens: 0 };
  unpricedModels = new Set();
  unpricedWorkspaces = new Set();
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
 * A cost cap is set but cannot be honoured. Deliberately NOT phrased as
 * "limit reached" — nothing was overspent; the limit is unenforceable, and
 * an operator sent to look at usage graphs would find nothing wrong. It
 * names both real ways out instead.
 */
const unpriceableMessage = (scope: SpendScope): string =>
  `A spending limit is set for this ${
    scope === 'workspace' ? 'workspace' : 'deployment'
  }, but Synora has no price for the model that would run, so it cannot hold that ` +
  'limit. Nothing was generated. Either add a price for the model, or remove the cost limit.';

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

export async function assertAiBudget(check: {
  workspaceId?: string;
  /**
   * The model about to run, when the caller knows it. Supplied so an
   * unpriceable model can be refused BEFORE it spends anything rather
   * than after — see the fail-closed check below.
   */
  model?: string;
}): Promise<void> {
  const now = new Date();
  const { globalMaxCostPerDayCents, globalMaxTokensPerDay } = globalCaps();

  // FAIL CLOSED ON AN UNKNOWN PRICE.
  //
  // Two ways the price can be unknown, and both must refuse:
  //  - the caller named a model that is not in the pricing table, or
  //  - a previous call in this process already spent on one (`unpricedModels`),
  //    which is the only way to catch a model the caller could not name.
  //
  // Deliberately NOT refused when no cost cap is configured. A deployment
  // that never asked for a cost ceiling was never promised one, and
  // blocking there would break local and self-hosted use for no safety
  // gain whatsoever — the whole point of running your own model is that it
  // has no per-token price. The TOKEN cap is unaffected either way, since
  // tokens are counted without needing to know a price, and the token cap
  // is what genuinely bounds local inference.
  const namedModelUnpriceable = check.model !== undefined && !isPriceKnown(check.model);

  if (globalMaxCostPerDayCents !== undefined && (namedModelUnpriceable || unpricedModels.size > 0)) {
    throw new AiBudgetExceededError('global', 'daily-cost', unpriceableMessage('global'));
  }

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

  // The same fail-closed rule at workspace scope. Checked BEFORE the window
  // resets below because it is window-independent — midnight does not make
  // the model priceable — and refusing early saves a pointless write. Only
  // a COST cap is broken by a missing price; a workspace that set only a
  // token cap is still fully enforced and must not be refused.
  const workspaceCostCap = budget.maxCostPerDayCents ?? budget.maxCostPerMonthCents;
  if (
    workspaceCostCap !== null &&
    (namedModelUnpriceable || unpricedWorkspaces.has(check.workspaceId))
  ) {
    throw new AiBudgetExceededError(
      'workspace',
      budget.maxCostPerDayCents !== null ? 'daily-cost' : 'monthly-cost',
      unpriceableMessage('workspace')
    );
  }

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
  /**
   * False when this deployment has no price for the model, in which case
   * `costCents` is 0 because there was no honest number to charge — NOT
   * because the call was free. Anything reading `costCents` for a total
   * has to read this too, or it will publish a figure that silently
   * excludes an unknown amount of real spending.
   */
  priceKnown: boolean;
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
  const costUsd = estimateCostOrUnknown(
    record.model,
    record.inputTokens ?? (estimated ? tokens : 0),
    record.outputTokens ?? 0
  );
  // Unknown price contributes 0 to the COST window — there is no honest
  // number to add, and inventing one would put a fabricated figure in a
  // ledger. Zero would be a lie by itself, so it never travels alone:
  // the model is remembered as unpriceable, which is what makes the next
  // `assertAiBudget` refuse while a cost cap is set. Tokens are still
  // counted below, so the token cap stays fully effective throughout.
  const priceKnown = costUsd !== null;
  const costCents = costUsd === null ? 0 : Math.ceil(costUsd * 100);

  if (!priceKnown) {
    // Logged once per model, not once per call: an entirely self-hosted
    // deployment hits this on every single generation, and a warning that
    // fires thousands of times a day is a warning nobody reads.
    if (!unpricedModels.has(record.model)) {
      logger.warn(
        '[SpendGuard] No price for this model — its spend cannot be counted towards any cost cap',
        { provider: record.provider, model: record.model }
      );
    }
    unpricedModels.add(record.model);
    if (record.workspaceId) unpricedWorkspaces.add(record.workspaceId);
  }

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

  return { tokens, costCents, estimated, priceKnown };
}
