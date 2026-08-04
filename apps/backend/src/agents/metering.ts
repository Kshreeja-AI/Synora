import { prisma } from '@synora/database';
import { recordUsage, InsufficientCreditsError } from '../services/credit.service.js';
import { logger } from '../utils/logger.js';
import type { AgentRun } from './types.js';

/**
 * Run metering: what a run consumed, recorded into the same usage ledger
 * everything else bills through.
 *
 * TWO ACCOUNTING RULES CARRY THE DESIGN.
 *
 * 1. Usage is always counted; deduction is best-effort. A completed run
 *    consumed real steps and tool calls whether or not the workspace has a
 *    credits balance, and losing that record because a deduction failed
 *    would make the usage history lie by omission. So the UsageRecord is
 *    written unconditionally, and when credits could not be deducted the
 *    record says so in its metadata rather than pretending it was paid.
 *
 * 2. Deterministic generate-steps cost zero. When no provider is
 *    configured, a generate step runs the local deterministic generator —
 *    no tokens were bought, so charging credits for it would fabricate a
 *    cost that never existed. Tool calls are charged regardless of plan
 *    origin, because a tool does real work either way. The price table is
 *    below, in one place, so "what does a run cost" has one answer.
 *
 * Metering never fails a run. A run that completed must not be reported
 *    failed because accounting hiccuped; failures land in the log and in
 *    the returned outcome, not in the run's state.
 */

/** Credits per unit. One table, so pricing has one home. */
export const RUN_PRICING = {
  /** A generate step planned by a real model. */
  modelGenerateStep: 1,
  /** A generate step from the deterministic local runtime: no tokens were
   * bought, so no credits are charged. Quantity is still counted. */
  localGenerateStep: 0,
  /** A tool call does real work regardless of what planned it. */
  toolCall: 1,
} as const;

export interface RunUsage {
  generateSteps: number;
  toolCalls: number;
  creditsCost: number;
}

/** Derives usage from what ACTUALLY executed — attempted steps, not plan size. */
export function computeRunUsage(run: AgentRun): RunUsage {
  let generateSteps = 0;
  const toolCalls = run.toolCallsUsed;

  for (const record of run.steps) {
    if (record.attempts === 0) continue;
    if (record.step.kind === 'generate') generateSteps += 1;
  }

  const generatePrice =
    run.plan?.origin === 'model' ? RUN_PRICING.modelGenerateStep : RUN_PRICING.localGenerateStep;

  return {
    generateSteps,
    toolCalls,
    creditsCost: generateSteps * generatePrice + toolCalls * RUN_PRICING.toolCall,
  };
}

export interface MeterOutcome {
  recorded: boolean;
  creditsCost: number;
  deducted: boolean;
}

/** In-process guard against double-metering one terminal transition. */
const metered = new Set<string>();

/**
 * Records a terminal run into the usage ledger. Call at the moment a run
 * reaches a terminal state; hydrated (already-terminal) runs are never
 * re-metered because hydration does not call this.
 */
export async function meterRun(params: {
  run: AgentRun;
  /** 'agent-run' or 'workflow-run' — the capability line in the ledger. */
  capability: 'agent-run' | 'workflow-run';
}): Promise<MeterOutcome> {
  const { run, capability } = params;
  if (metered.has(run.id)) return { recorded: false, creditsCost: 0, deducted: false };

  const usage = computeRunUsage(run);
  // A run that executed nothing (refused plan, cancelled before any step)
  // consumed nothing worth a ledger line.
  if (usage.generateSteps === 0 && usage.toolCalls === 0) {
    metered.add(run.id);
    return { recorded: false, creditsCost: 0, deducted: false };
  }

  const metadata = {
    runId: run.id,
    agentId: run.agentId,
    state: run.state,
    planOrigin: run.plan?.origin ?? 'unknown',
    generateSteps: usage.generateSteps,
    toolCalls: usage.toolCalls,
  };

  try {
    if (usage.creditsCost > 0) {
      // The full path: usage record + ledger entry + balance deduction.
      await recordUsage(run.workspaceId, {
        capability,
        quantity: usage.generateSteps + usage.toolCalls,
        creditsCost: usage.creditsCost,
        userId: run.requestedBy,
        metadata: { ...metadata, deducted: true },
      });
      metered.add(run.id);
      return { recorded: true, creditsCost: usage.creditsCost, deducted: true };
    }
  } catch (err) {
    // Deduction failed — no credits row (every local workspace) or an
    // insufficient balance discovered post-hoc. The usage still happened,
    // so it falls through to the count-only record below rather than
    // vanishing from history.
    const reason =
      err instanceof InsufficientCreditsError ? 'insufficient-balance' : 'no-credits-account';
    logger.warn('Run usage recorded without credit deduction.', {
      runId: run.id,
      creditsCost: usage.creditsCost,
      reason,
    });
    return countOnly(run, capability, usage, { ...metadata, deducted: false, reason });
  }

  // Zero-cost path (deterministic generate-only run): counted, not billed.
  return countOnly(run, capability, usage, { ...metadata, deducted: false, reason: 'zero-cost' });
}

async function countOnly(
  run: AgentRun,
  capability: string,
  usage: RunUsage,
  metadata: Record<string, unknown>,
): Promise<MeterOutcome> {
  try {
    await prisma.usageRecord.create({
      data: {
        workspaceId: run.workspaceId,
        userId: run.requestedBy,
        capability,
        quantity: usage.generateSteps + usage.toolCalls,
        // What it WOULD have cost, so the record is honest about the value
        // consumed even when nothing was deducted.
        creditsCost: usage.creditsCost,
        metadata: metadata as never,
      },
    });
    metered.add(run.id);
    return { recorded: true, creditsCost: usage.creditsCost, deducted: false };
  } catch (err) {
    logger.warn('Recording run usage failed; the run itself is unaffected.', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { recorded: false, creditsCost: usage.creditsCost, deducted: false };
  }
}

/** Test-only. */
export function resetMetering(): void {
  metered.clear();
}
