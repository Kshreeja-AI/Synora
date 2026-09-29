import { getProviderMatrix, type ProviderMatrixEntry } from './provider-observatory.js';

/**
 * Ranks candidate providers on recorded evidence rather than configuration.
 *
 * WHAT IT IS AND IS NOT. This recommends; it does not intercept. Product
 * code asks for a recommendation and decides what to do with it. Nothing
 * here reaches into a request path, so adopting evidence-driven routing is
 * a deliberate change at each call site rather than a behaviour that
 * silently switches on. That matters because this is the first component
 * whose output could affect what a customer receives, and a silent change
 * to customer-facing behaviour is not something a monitoring platform
 * should be able to make.
 *
 * IT NEVER INVENTS A PREFERENCE. With no evidence — a fresh process, a new
 * model, a capability that has never run — it returns the configured order
 * and says the basis was configuration, not evidence. Ranking on nothing
 * would produce a confident-looking recommendation derived from noise,
 * which is worse than admitting the platform has nothing to add yet.
 *
 * THE WEIGHTS ARE A JUDGEMENT, AND ARE STATED. Combining reliability,
 * latency, and cost into one score requires deciding what matters most.
 * That is not a measurement, so the weights are explicit, adjustable, and
 * reported with the decision. The default puts reliability first: a
 * provider that fails is worthless however cheap or fast it is.
 */

export interface RoutingWeights {
  reliability: number;
  latency: number;
  cost: number;
}

/** Reliability first — a failed response has no value at any price. */
export const DEFAULT_WEIGHTS: RoutingWeights = { reliability: 0.6, latency: 0.25, cost: 0.15 };

export interface RoutingCandidate {
  providerId: string;
  modelId: string;
}

export interface RankedCandidate {
  providerId: string;
  modelId: string;
  /** 0..1, higher is better. Null when this candidate has no evidence. */
  score: number | null;
  requests: number;
  successRate: number | null;
  p95LatencyMs: number | null;
  costPerRequestCents: number | null;
  /** Why this candidate could not be scored. Absent when it was. */
  unscoredReason?: string;
}

export interface RoutingDecision {
  /** The recommended candidate. Never null — a decision is always returned. */
  chosen: RoutingCandidate;
  /**
   * 'evidence' when the choice came from measurements, 'configuration' when
   * there was not enough evidence and the configured order was kept.
   */
  basis: 'evidence' | 'configuration';
  reasoning: string;
  weights: RoutingWeights;
  ranked: RankedCandidate[];
  /** How many candidates had enough traffic to be scored at all. */
  scoredCandidates: number;
  /**
   * True when the leader's raw measurements are barely distinguishable from
   * the runner-up's. Scores are relative, so a near-tie still produces a
   * decisive-looking 1.00 against 0.00 — this says when that gap is an
   * artefact of the scale rather than a real difference.
   */
  closeCall: boolean;
}

/** Below this, a candidate's rates are too noisy to rank on. */
const MIN_REQUESTS_TO_SCORE = 30;

function findEntry(
  matrix: ProviderMatrixEntry[],
  candidate: RoutingCandidate,
): ProviderMatrixEntry | undefined {
  return matrix.find(
    (m) => m.providerId === candidate.providerId && m.modelId === candidate.modelId,
  );
}

/**
 * Normalises a value against the range observed across candidates, so a
 * score means "best of what we have" rather than "good in absolute terms" —
 * the platform holds no absolute targets and inventing one here would
 * reintroduce exactly the hardcoded expectation it avoids everywhere else.
 *
 * ALL THREE DIMENSIONS ARE NORMALISED THE SAME WAY, and that consistency is
 * load-bearing. An earlier version left the success rate as its raw 0..1
 * value while spreading latency and cost across the full range. Because
 * real success rates cluster near the top — 0.8 to 1.0 is a severe spread
 * in practice — a weight of 0.6 on reliability then carried *less*
 * influence than 0.25 on latency, and the weights did not mean what they
 * said. Normalising all three against their observed range is what makes a
 * weight an honest statement of relative importance.
 *
 * THE COST OF THAT CHOICE, stated rather than hidden: a score is a ranking
 * within this candidate set, never an absolute quality. Two candidates at
 * 99.9% and 100% become 0 and 1 on reliability, which looks decisive and is
 * not. `closeCall` exists to say so.
 */
function normalise(value: number, min: number, max: number, lowerIsBetter: boolean): number {
  if (max === min) return 1;
  const position = (value - min) / (max - min);
  return lowerIsBetter ? 1 - position : position;
}

export function rankCandidates(
  candidates: RoutingCandidate[],
  weights: RoutingWeights = DEFAULT_WEIGHTS,
): RankedCandidate[] {
  const matrix = getProviderMatrix();

  const withEvidence = candidates
    .map((candidate) => ({ candidate, entry: findEntry(matrix, candidate) }))
    .filter((row) => row.entry !== undefined && row.entry.requests >= MIN_REQUESTS_TO_SCORE) as Array<{
    candidate: RoutingCandidate;
    entry: ProviderMatrixEntry;
  }>;

  // Cost per request is only comparable where cost is actually known. A
  // candidate reporting no cost is not free; it is unmeasured, and giving
  // it a cost of zero would make it win the cost dimension outright.
  const costs = withEvidence
    .filter((row) => row.entry.tokenPriced || row.entry.pricingBasis)
    .map((row) => row.entry.totalCostCents / Math.max(1, row.entry.requests));
  const latencies = withEvidence.map((row) => row.entry.p95LatencyMs);
  const rates = withEvidence.map((row) => row.entry.successRate);

  const minCost = costs.length > 0 ? Math.min(...costs) : 0;
  const maxCost = costs.length > 0 ? Math.max(...costs) : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const minRate = rates.length > 0 ? Math.min(...rates) : 0;
  const maxRate = rates.length > 0 ? Math.max(...rates) : 0;

  return candidates.map((candidate): RankedCandidate => {
    const entry = findEntry(matrix, candidate);

    if (!entry) {
      return {
        ...candidate,
        score: null,
        requests: 0,
        successRate: null,
        p95LatencyMs: null,
        costPerRequestCents: null,
        unscoredReason: 'No traffic has ever been recorded for this provider and model.',
      };
    }

    if (entry.requests < MIN_REQUESTS_TO_SCORE) {
      return {
        ...candidate,
        score: null,
        requests: entry.requests,
        successRate: entry.successRate,
        p95LatencyMs: entry.p95LatencyMs,
        costPerRequestCents: null,
        unscoredReason: `Only ${entry.requests} requests recorded; ${MIN_REQUESTS_TO_SCORE} are needed before its rates mean anything.`,
      };
    }

    const priced = entry.tokenPriced || entry.pricingBasis;
    const costPerRequest = priced ? entry.totalCostCents / Math.max(1, entry.requests) : null;

    const reliabilityScore = normalise(entry.successRate, minRate, maxRate, false);
    const latencyScore = normalise(entry.p95LatencyMs, minLatency, maxLatency, true);
    // An unpriced candidate scores neutrally on cost rather than best or
    // worst. Scoring it best would reward not measuring; scoring it worst
    // would punish a capability for how its provider happens to bill.
    const costScore = costPerRequest === null ? 0.5 : normalise(costPerRequest, minCost, maxCost, true);

    const total = weights.reliability + weights.latency + weights.cost;
    const score =
      total > 0
        ? (reliabilityScore * weights.reliability +
            latencyScore * weights.latency +
            costScore * weights.cost) /
          total
        : 0;

    return {
      ...candidate,
      score,
      requests: entry.requests,
      successRate: entry.successRate,
      p95LatencyMs: entry.p95LatencyMs,
      costPerRequestCents: costPerRequest,
    };
  });
}

/**
 * Recommends a candidate. The first entry of `candidates` is treated as the
 * configured default, and is what gets returned when evidence is absent.
 */
export function recommendRoute(
  candidates: RoutingCandidate[],
  weights: RoutingWeights = DEFAULT_WEIGHTS,
): RoutingDecision | null {
  if (candidates.length === 0) return null;

  const ranked = rankCandidates(candidates, weights);
  const scored = ranked.filter((r) => r.score !== null);

  if (scored.length === 0) {
    return {
      chosen: { providerId: candidates[0].providerId, modelId: candidates[0].modelId },
      basis: 'configuration',
      reasoning:
        'No candidate has enough recorded traffic to rank, so the configured order was kept. ' +
        'This is an absence of evidence, not a judgement that the configured choice is best.',
      weights,
      ranked,
      scoredCandidates: 0,
      closeCall: false,
    };
  }

  const best = scored.reduce((a, b) => ((b.score as number) > (a.score as number) ? b : a));
  const runnerUp = scored.filter((r) => r !== best).sort((a, b) => (b.score as number) - (a.score as number))[0];

  // Compared on the raw measurements, not the scores, because the scores
  // are stretched to fill 0..1 whatever the real spread was.
  const closeCall =
    runnerUp !== undefined &&
    Math.abs((best.successRate ?? 0) - (runnerUp.successRate ?? 0)) < 0.01 &&
    Math.abs((best.p95LatencyMs ?? 0) - (runnerUp.p95LatencyMs ?? 0)) <=
      0.1 * Math.max(best.p95LatencyMs ?? 0, runnerUp.p95LatencyMs ?? 0);

  return {
    chosen: { providerId: best.providerId, modelId: best.modelId },
    basis: 'evidence',
    reasoning:
      `Ranked ${scored.length} of ${candidates.length} candidates on recorded traffic. ` +
      `${best.providerId} / ${best.modelId} scored highest at ${(best.score as number).toFixed(2)} ` +
      `(success ${Math.round((best.successRate ?? 0) * 100)}%, p95 ${best.p95LatencyMs} ms` +
      `${best.costPerRequestCents === null ? ', cost unmeasured' : `, ${best.costPerRequestCents.toFixed(4)}¢ per request`}).` +
      (closeCall
        ? ' The leader and runner-up are within measurement noise of each other, so this ranking should not be treated as a meaningful difference.'
        : ''),
    weights,
    ranked,
    scoredCandidates: scored.length,
    closeCall,
  };
}
