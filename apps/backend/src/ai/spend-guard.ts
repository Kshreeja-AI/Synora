import { prisma } from '@synora/database';
import { getConfig } from '../config';
import { maxKnownRatePer1k, priceModelUsd } from './pricing';
import { getProviderDescriptor } from './registry';
import { getRedisConnection } from '../queue/redis';
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
 * THREE LAYERS, INDEPENDENTLY BINDING:
 *  - Global (`AiGlobalSpendDay`, Postgres, one row per UTC day): the
 *    deployment's kill switch. Applies to every call, including ones with
 *    no workspace (system judges, unscoped API use). Absent config means no
 *    global cap — the dev default.
 *  - Per-user (Redis, 26h TTL): a fairness ceiling so one account cannot
 *    drain a whole workspace. Applies only where the path knows the user.
 *  - Per-workspace (`AiSpendBudget` row): a workspace WITHOUT a row runs
 *    uncapped by this layer, mirroring `agents/metering.ts`'s "a workspace
 *    without a credits account has not opted into billing" rule.
 *
 * NOTHING LIVES IN PROCESS MEMORY. The global counter was once a module
 * variable; N instances each admitted the FULL cap and a restart forgot the
 * day's spend, so a crash loop reset the budget every time.
 *
 * TOKENS AND CENTS ARE SEPARATE CAPS on purpose. Providers that DECLARE
 * themselves `unmetered` (Ollama, self-hosted) cost nothing per token, so a
 * cost cap never binds them; the token cap is what bounds local inference.
 * Conversely a hosted model's dollars are what hurt, and `maxTokensPerDay`
 * may legitimately be unset there.
 *
 * WORKLOADS THIS MODULE CANNOT PRICE — media units, embeddings — pass
 * `knownCostCents` computed by the caller that owns their real price table.
 * Applying frontier-text token rates to an embedding (100–1000× cheaper) or
 * to an image (not token-priced at all) would refuse workspaces on fantasy
 * numbers. This module owns the atomic accounting and the caps; the caller
 * owns the price of its own workload.
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

export type SpendScope = 'workspace' | 'global' | 'user';
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
 * The deployment-wide counter, in the DATABASE.
 *
 * It used to be a module-level object. That was defensible as a
 * single-process kill switch and indefensible in production: N instances
 * would each admit the FULL cap (a 3-instance deploy silently had a 3×
 * limit), and a restart forgot the day's spend entirely — so a crash loop
 * reset the budget to zero every time. A financial control may not live in
 * process memory.
 *
 * One row per UTC day, keyed by the day string, so rolling over is simply
 * writing a different row: there is no reset path, and therefore no reset
 * race. Increments are SQL-atomic.
 *
 * A one-second in-process cache fronts the READ (never the write) so the
 * gate does not issue a query per call under load. It is a bounded
 * staleness allowance, not a source of truth.
 */
const GLOBAL_CACHE_MS = 1_000;
let globalCache: { dayUtc: string; costCents: number; tokens: number; readAt: number } | null = null;

function utcDayKey(now: Date): string {
  return startOfUtcDay(now).toISOString().slice(0, 10);
}

async function readGlobalWindow(now: Date): Promise<{ costCents: number; tokens: number }> {
  const dayUtc = utcDayKey(now);
  if (
    globalCache &&
    globalCache.dayUtc === dayUtc &&
    Date.now() - globalCache.readAt < GLOBAL_CACHE_MS
  ) {
    return { costCents: globalCache.costCents, tokens: globalCache.tokens };
  }
  try {
    const row = await prisma.aiGlobalSpendDay.findUnique({ where: { dayUtc } });
    const value = { costCents: row?.costCents ?? 0, tokens: row?.tokens ?? 0 };
    globalCache = { dayUtc, ...value, readAt: Date.now() };
    return value;
  } catch {
    // A database that cannot be read cannot prove the cap is intact. The
    // last known value is the honest fallback — NOT zero, which would read
    // as "nothing spent today" and open the gate exactly when the system
    // is least healthy.
    if (globalCache && globalCache.dayUtc === dayUtc) {
      return { costCents: globalCache.costCents, tokens: globalCache.tokens };
    }
    return { costCents: 0, tokens: 0 };
  }
}

/** Test seam — clears the read cache. */
export function resetGlobalSpendForTesting(): void {
  globalCache = null;
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
    : scope === 'user'
      ? 'You have reached your personal AI usage limit for today, so nothing was generated. The limit resets at midnight UTC.'
      : 'This deployment has reached its AI usage limit for today, so nothing was generated. The limit resets at midnight UTC.';

/**
 * Per-user daily spend, in Redis so the ceiling holds across instances.
 *
 * Redis rather than Postgres: this is a high-frequency counter with a
 * natural 24h expiry, which is exactly what INCRBY+EXPIRE is for, and it
 * keeps per-request write amplification off the primary database.
 *
 * FAILS OPEN, deliberately and narrowly. If Redis is unreachable the
 * per-user ceiling stops binding — but the GLOBAL cap (Postgres) and the
 * WORKSPACE cap (Postgres) both still do, so spend remains bounded. The
 * alternative, refusing every AI request whenever the cache is down, turns
 * a Redis blip into a total product outage for a control that is a
 * fairness ceiling, not the primary money guard.
 */
const USER_SPEND_KEY_TTL_SECONDS = 60 * 60 * 26;

function userSpendKey(userId: string, now: Date): string {
  return `synora:aispend:user:${userId}:${utcDayKey(now)}`;
}

async function readUserSpendCents(userId: string, now: Date): Promise<number> {
  try {
    const value = await getRedisConnection().get(userSpendKey(userId, now));
    return value ? Number.parseInt(value, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

async function addUserSpendCents(userId: string, now: Date, costCents: number): Promise<void> {
  if (costCents <= 0) return;
  try {
    const key = userSpendKey(userId, now);
    const redis = getRedisConnection();
    await redis.incrby(key, costCents);
    await redis.expire(key, USER_SPEND_KEY_TTL_SECONDS);
  } catch (error) {
    logger.warn('[SpendGuard] Per-user spend not recorded — Redis unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
function globalCaps(): {
  globalMaxCostPerDayCents?: number;
  globalMaxTokensPerDay?: number;
  userMaxCostPerDayCents?: number;
} {
  try {
    const { globalMaxCostPerDayCents, globalMaxTokensPerDay, userMaxCostPerDayCents } =
      getConfig().ai;
    return { globalMaxCostPerDayCents, globalMaxTokensPerDay, userMaxCostPerDayCents };
  } catch {
    return {};
  }
}

export async function assertAiBudget(check: {
  workspaceId?: string;
  /** Present wherever the calling path knows who is asking. */
  userId?: string;
  /**
   * The model about to run, where the caller knows it. Accepted so a
   * pre-flight check can reason about an unpriceable model BEFORE any spend
   * occurs, rather than discovering it only while recording the charge.
   * Optional because several callers legitimately do not know the model until
   * the provider resolves one.
   */
  model?: string;
}): Promise<void> {
  const now = new Date();
  const { globalMaxCostPerDayCents, globalMaxTokensPerDay, userMaxCostPerDayCents } = globalCaps();

  // Queried only when a global cap exists, so an uncapped development
  // deployment does not pay for a database round-trip on every call.
  if (globalMaxCostPerDayCents !== undefined || globalMaxTokensPerDay !== undefined) {
    const window = await readGlobalWindow(now);
    if (globalMaxCostPerDayCents !== undefined && window.costCents >= globalMaxCostPerDayCents) {
      throw new AiBudgetExceededError('global', 'daily-cost', budgetMessage('global', 'daily-cost'));
    }
    if (globalMaxTokensPerDay !== undefined && window.tokens >= globalMaxTokensPerDay) {
      throw new AiBudgetExceededError(
        'global',
        'daily-tokens',
        budgetMessage('global', 'daily-tokens')
      );
    }
  }

  // Per-user. Skipped when unconfigured, and when the path cannot say who
  // is asking — a cap applied to "unknown user" would pool every anonymous
  // system call into one bucket and refuse them together.
  if (userMaxCostPerDayCents !== undefined && check.userId) {
    const spent = await readUserSpendCents(check.userId, now);
    if (spent >= userMaxCostPerDayCents) {
      throw new AiBudgetExceededError('user', 'daily-cost', budgetMessage('user', 'daily-cost'));
    }
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
  /** Present wherever the calling path knows who is asking; drives the per-user cap. */
  userId?: string;
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
  /**
   * CALLER-COMPUTED cost in cents, for workloads whose economics this
   * module cannot derive from text-token tables — media units, embeddings.
   *
   * When present, this IS the cost: the guard's own text pricing is not
   * consulted, because applying frontier-text rates to an embedding
   * (100–1000× cheaper per token) or to an image (not token-priced at all)
   * would refuse workspaces on fantasy numbers. The caller that owns the
   * workload's real price table computes it; this module owns the atomic
   * accounting and the caps.
   *
   * `0` is a legitimate value (a provider's genuinely free tier, priced as
   * an explicit zero in the caller's table) and is distinct from absent.
   */
  knownCostCents?: number;
}

export interface AiSpendOutcome {
  tokens: number;
  costCents: number;
  /** True when the provider reported nothing and the floor estimate was charged. */
  estimated: boolean;
  /**
   * True when this was a METERED provider whose model is not in the price
   * table, so a ceiling was charged instead of a real price. Surfaced so an
   * operator can see that a cap is being enforced on an estimate and add
   * the missing entry — silence here would let the ceiling become permanent.
   */
  unpricedModel: boolean;
}

/**
 * What to charge, in cents, for spend that just happened.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. Cost used to come straight from
 * `estimateCost`, which returns 0 for any model missing from the price
 * table. A dollar cap therefore never bound an unpriced model — and
 * `ANTHROPIC_MODEL` is free-form env config, so an ordinary value like a
 * dated snapshot (`claude-sonnet-5-20250514`) is not a table key. Someone
 * who set a $5/day cap and a real model name had no cap at all.
 *
 * Three cases, and the middle one is the whole point:
 *
 *  - UNMETERED provider (Ollama, self-hosted): genuinely 0. Declared by the
 *    provider, never inferred from a missing price — the two are
 *    indistinguishable to arithmetic and opposite to a bill. Tokens are
 *    still counted, so the daily TOKEN cap bounds local inference.
 *  - METERED with an UNKNOWN price: charge a CEILING at the most expensive
 *    rate the table knows. Deliberately pessimistic. Over-charging refuses a
 *    caller slightly early, which is recoverable; under-charging spends real
 *    money, which is not.
 *  - METERED with a known price: the real price.
 *
 * An UNRECOGNIZED provider id is treated as metered. A provider this build
 * cannot identify is not evidence that it is free.
 */
function costCentsFor(record: AiSpendRecord, tokens: number): { costCents: number; unpriced: boolean } {
  // A caller that owns its workload's real price table wins outright.
  // Checked FIRST, before the provider-registry lookup, because media and
  // embedding provider ids are not in the text registry — resolving them
  // there would misclassify, and the whole point of this channel is that
  // the caller already did the pricing correctly.
  if (record.knownCostCents !== undefined) {
    return { costCents: Math.max(0, Math.ceil(record.knownCostCents)), unpriced: false };
  }

  const descriptor = getProviderDescriptor(record.provider);
  if (descriptor?.metering === 'unmetered') {
    return { costCents: 0, unpriced: false };
  }

  const inputTokens = record.inputTokens ?? (record.outputTokens === undefined ? tokens : 0);
  const outputTokens = record.outputTokens ?? 0;

  const priced = priceModelUsd(record.model, inputTokens, outputTokens);
  if (priced.known) {
    return { costCents: Math.ceil(priced.costUsd * 100), unpriced: false };
  }

  const ceiling = maxKnownRatePer1k();
  const costUsd =
    (inputTokens / 1000) * ceiling.inputPer1k + (outputTokens / 1000) * ceiling.outputPer1k;
  return { costCents: Math.ceil(costUsd * 100), unpriced: true };
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
  // BELT AND BRACES, because this module's contract is "never throws" and a
  // throw here has already happened once in real life: a provider returned a
  // result with no model id, `normalizeModelId` threw on it, and the
  // exception surfaced from the ACCOUNTING path of a generation that had
  // already succeeded and already cost money — failing the caller's request
  // for a reason that had nothing to do with their request.
  //
  // `pricing.ts` now tolerates an absent id directly, so this catch should be
  // unreachable. It stays because "should be unreachable" is exactly what was
  // believed before, and because the fallback is the safe direction: charge
  // the ceiling, shout about it, and let the request through.
  let costCents: number;
  let unpriced: boolean;
  try {
    ({ costCents, unpriced } = costCentsFor(record, tokens));
  } catch (error) {
    const ceiling = maxKnownRatePer1k();
    costCents = Math.ceil(((tokens / 1000) * ceiling.outputPer1k) * 100);
    unpriced = true;
    logger.error('[SpendGuard] Pricing threw — charging the ceiling rather than failing the call', {
      provider: record.provider,
      model: record.model,
      tokens,
      chargedCents: costCents,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (unpriced) {
    // Loud on purpose. A ceiling is a safe stopgap, not a resting state:
    // the cap is now enforced on a guess, and the fix is one price-table
    // entry. Logged every time rather than once, because a rate-limited
    // warning is how this becomes permanent.
    logger.warn('[SpendGuard] Charging a CEILING price — model missing from the price table', {
      provider: record.provider,
      model: record.model,
      tokens,
      chargedCents: costCents,
      action: 'add this model to MODEL_PRICING in ai/pricing.ts',
    });
  }

  const now = new Date();
  const dayUtc = utcDayKey(now);

  // The deployment-wide ledger, SQL-atomic and durable. Wrapped because
  // accounting failure must never fail a generation that already happened.
  try {
    await prisma.aiGlobalSpendDay.upsert({
      where: { dayUtc },
      create: { dayUtc, costCents, tokens },
      update: { costCents: { increment: costCents }, tokens: { increment: tokens } },
    });
    // Refresh the read cache from what we just wrote rather than waiting
    // for it to expire, so a burst on one instance sees its own spend
    // immediately instead of up to a second late.
    const previous = globalCache && globalCache.dayUtc === dayUtc ? globalCache : null;
    globalCache = {
      dayUtc,
      costCents: (previous?.costCents ?? 0) + costCents,
      tokens: (previous?.tokens ?? 0) + tokens,
      readAt: previous ? previous.readAt : 0,
    };
  } catch (error) {
    logger.error('[SpendGuard] Global spend not recorded — the deployment ledger is behind', {
      dayUtc,
      costCents,
      tokens,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (record.userId) {
    await addUserSpendCents(record.userId, now, costCents);
  }

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

  return { tokens, costCents, estimated, unpricedModel: unpriced };
}
