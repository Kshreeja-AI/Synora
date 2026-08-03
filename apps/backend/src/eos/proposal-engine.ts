import { engineeringEventBus } from './event-bus.js';
import { getPromptReport } from './prompt-intelligence.js';
import { getProviderMatrix } from './provider-observatory.js';
import { getCases } from './evaluation-datasets.js';
import type { DraftResult } from './draft-generator.js';

/**
 * Turns a detected problem into a reviewable proposal.
 *
 * GOVERNANCE — the defining constraint of this module.
 *
 * This engine proposes and nothing else. It has no capability to modify
 * code, create branches, alter configuration, or touch any protected
 * resource, and that is enforced structurally rather than by policy: it
 * imports only read-only accessors, and a Proposal is an inert record
 * describing what *could* be done. There is deliberately no `apply()`.
 *
 * Founder approval is the gate. Approving a proposal here records a
 * decision; it does not execute anything. Execution, when it exists, will
 * be a separate component that can only run against approved proposals.
 */

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface ProposalEvidence {
  /** What was observed, in plain terms. */
  summary: string;
  /** The measurements behind it, so the claim can be checked rather than trusted. */
  metrics: Record<string, string | number>;
  /** Identifiers of captured real cases demonstrating the problem. */
  affectedCaseIds: string[];
}

export interface Proposal {
  id: string;
  createdAt: number;
  /** What triggered this, e.g. 'prompt-regression'. */
  trigger: string;
  title: string;
  /** What the platform believes is wrong. */
  problem: string;
  /** What it suggests doing — described, never performed. */
  suggestedAction: string;
  /**
   * Why this is a suggestion rather than a certainty. Recorded so a
   * reviewer sees the limits of the reasoning alongside the reasoning.
   */
  caveats: string[];
  evidence: ProposalEvidence;
  status: ProposalStatus;
  decidedAt?: number;
  decisionNote?: string;
  /**
   * A candidate revision and what measuring it showed. Attached after the
   * proposal is created, because drafting requires provider calls that must
   * not block the alert path. Absent means no draft exists — never that a
   * draft was tried and found unnecessary.
   */
  draft?: {
    text: string | null;
    summary: string;
    unavailable: string[];
    verdict?: string;
    meanScoreDelta?: number;
    passRateDelta?: number;
  };
}

const proposals = new Map<string, Proposal>();
/** One unsubscribe per detector the engine listens to. */
let unsubscribers: Array<() => void> = [];
let maxProposals = 200;
let counter = 0;

/**
 * Builds a proposal from a prompt regression. Read-only: it queries the
 * report, matrix, and case library, and composes a record.
 */
export function buildPromptRegressionProposal(params: {
  promptId: string;
  version: number;
  overallSuccessRate: number;
  recentSuccessRate: number;
  windowSize: number;
  captureDatasetId?: string;
}): Proposal {
  const report = getPromptReport().find(
    (p) => p.promptId === params.promptId && p.version === params.version,
  );

  // Cases captured from this prompt are the concrete failures a reviewer
  // can read, rather than a percentage they have to take on faith.
  const affectedCaseIds = params.captureDatasetId
    ? getCases(params.captureDatasetId)
        .filter((c) => c.tags.includes(`prompt:${params.promptId}`))
        .slice(-10)
        .map((c) => c.id)
    : [];

  const providers = getProviderMatrix();
  const degraded = providers.filter((p) => p.requests > 0 && p.successRate < 1);

  const dropPoints = Math.round((params.overallSuccessRate - params.recentSuccessRate) * 100);

  const caveats: string[] = [
    'Correlation, not diagnosis: a success-rate drop does not identify the cause.',
    'The prompt may be fine and the provider may have changed underneath it.',
  ];
  if (affectedCaseIds.length === 0) {
    caveats.push('No captured cases are available, so the failures cannot be inspected directly.');
  }
  if (degraded.length > 0) {
    caveats.push(
      `${degraded.length} provider/model row(s) are also below a 100% success rate, which may be the underlying cause rather than the prompt.`,
    );
  }

  const id = `prop_${Date.now()}_${++counter}`;
  return {
    id,
    createdAt: Date.now(),
    trigger: 'prompt-regression',
    title: `Prompt "${params.promptId}" v${params.version} is regressing`,
    problem:
      `Recent success rate fell to ${Math.round(params.recentSuccessRate * 100)}% against a historical ` +
      `${Math.round(params.overallSuccessRate * 100)}%, a drop of ${dropPoints} percentage points over the ` +
      `last ${params.windowSize} executions.`,
    suggestedAction:
      'Review the captured failing cases, then evaluate a revised prompt against them using the ' +
      'evaluation platform. Compare the two runs before changing anything in production.',
    caveats,
    evidence: {
      summary: `Prompt regression detected on ${params.promptId} v${params.version}.`,
      metrics: {
        overallSuccessRate: `${Math.round(params.overallSuccessRate * 100)}%`,
        recentSuccessRate: `${Math.round(params.recentSuccessRate * 100)}%`,
        dropPercentagePoints: dropPoints,
        windowSize: params.windowSize,
        executions: report?.executions ?? 0,
        p95LatencyMs: report?.p95LatencyMs ?? 0,
        totalCostCents: report?.totalCostCents ?? 0,
      },
      affectedCaseIds,
    },
    status: 'pending',
  };
}

/**
 * Builds a proposal from a cost anomaly. Read-only, like its sibling above.
 *
 * The hardest thing to state honestly here is that a rise in cost per
 * request is frequently correct behaviour — longer conversations cost more.
 * The caveats say so, because a proposal that treats every rise as a defect
 * would train the reader to dismiss all of them.
 */
export function buildCostAnomalyProposal(params: {
  providerId: string;
  modelId: string;
  baselineCostCents: number;
  recentCostCents: number;
  ratio: number | null;
  baselineSamples: number;
  windowSize: number;
}): Proposal {
  const matrixEntry = getProviderMatrix().find(
    (p) => p.providerId === params.providerId && p.modelId === params.modelId,
  );

  const caveats: string[] = [
    'Correlation, not diagnosis: cost per request rose, but this does not say why.',
    'A rise can be entirely legitimate — longer inputs, longer outputs, or a deliberate switch to a more capable model all raise cost per request without anything being wrong.',
  ];

  if (params.ratio === null) {
    caveats.push(
      'There was no recorded cost before this window, so there is no baseline to multiply. This is a change from nothing to something, not a measured multiple.',
    );
  }
  if (matrixEntry && matrixEntry.successRate < 1) {
    caveats.push(
      `This model is also failing ${Math.round((1 - matrixEntry.successRate) * 100)}% of its requests; retries after failures inflate cost per request without any pricing change.`,
    );
  }
  caveats.push(
    'Only token-priced capabilities are covered. Image and audio generation report no cost data at all, so their spend is not measured here and would not appear as an anomaly.',
  );

  const describedChange =
    params.ratio === null
      ? `rose from no recorded cost to ${params.recentCostCents.toFixed(4)} cents per request`
      : `rose ${params.ratio.toFixed(1)}× — from ${params.baselineCostCents.toFixed(4)} to ` +
        `${params.recentCostCents.toFixed(4)} cents per request`;

  const id = `prop_${Date.now()}_${++counter}`;
  return {
    id,
    createdAt: Date.now(),
    trigger: 'cost-anomaly',
    title: `Cost per request on ${params.providerId} / ${params.modelId} has risen`,
    problem:
      `Over the last ${params.windowSize} requests, cost per request ${describedChange}, ` +
      `measured against a baseline of ${params.baselineSamples} earlier requests.`,
    suggestedAction:
      'Compare the recent requests’ input and output token counts against the baseline period. ' +
      'If the sizes are unchanged, the price or the model selection changed underneath you — check ' +
      'the provider’s pricing and which model the router actually chose. Confirm the cause before ' +
      'changing anything in production.',
    caveats,
    evidence: {
      summary: `Cost anomaly detected on ${params.providerId} / ${params.modelId}.`,
      metrics: {
        baselineCostCentsPerRequest: params.baselineCostCents.toFixed(4),
        recentCostCentsPerRequest: params.recentCostCents.toFixed(4),
        // A ratio of null means "not computable", and must not display as 0.
        ratio: params.ratio === null ? 'not computable (baseline was zero)' : `${params.ratio.toFixed(2)}×`,
        baselineSamples: params.baselineSamples,
        windowSize: params.windowSize,
        totalRequests: matrixEntry?.requests ?? 0,
        totalSpendCents: matrixEntry?.totalCostCents ?? 0,
      },
      // Cost is measured per request, not per captured case. Claiming case
      // evidence here would be inventing a link that was never recorded.
      affectedCaseIds: [],
    },
    status: 'pending',
  };
}

function record(proposal: Proposal): void {
  proposals.set(proposal.id, proposal);
  if (proposals.size > maxProposals) {
    const oldest = [...proposals.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) proposals.delete(oldest.id);
  }
  engineeringEventBus.emit({
    type: 'proposal.created',
    timestamp: proposal.createdAt,
    source: 'proposal-engine',
    payload: {
      proposalId: proposal.id,
      trigger: proposal.trigger,
      title: proposal.title,
      affectedCases: proposal.evidence.affectedCaseIds.length,
      caveats: proposal.caveats.length,
    },
  });
}

export function startProposalEngine(opts: { captureDatasetId?: string; maxProposals?: number } = {}): void {
  if (unsubscribers.length > 0) return;
  maxProposals = opts.maxProposals ?? 200;

  unsubscribers.push(
    engineeringEventBus.on('alert.prompt_regression', (event) => {
      try {
        const p = event.payload as {
          promptId: string;
          version: number;
          overallSuccessRate: number;
          recentSuccessRate: number;
          windowSize: number;
        };
        record(buildPromptRegressionProposal({ ...p, captureDatasetId: opts.captureDatasetId }));
      } catch {
        // Proposal generation must never destabilise the event bus.
      }
    }),
  );

  unsubscribers.push(
    engineeringEventBus.on('alert.cost_anomaly', (event) => {
      try {
        const p = event.payload as {
          providerId: string;
          modelId: string;
          baselineCostCents: number;
          recentCostCents: number;
          ratio: number | null;
          baselineSamples: number;
          windowSize: number;
        };
        record(buildCostAnomalyProposal(p));
      } catch {
        // One detector failing must never silence the others.
      }
    }),
  );
}

export function stopProposalEngine(): void {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  proposals.clear();
  counter = 0;
}

/**
 * Attaches a draft to an existing proposal. Separate from creation because
 * drafting calls a provider, and a slow or failing provider must never stop
 * the problem itself from being reported.
 *
 * This records text and measurements. It does not change any prompt, and
 * the proposal remains pending regardless of how well the draft scored — a
 * good score is evidence for the founder, not a substitute for the founder.
 */
export function attachDraft(id: string, draft: DraftResult): Proposal | null {
  const proposal = proposals.get(id);
  if (!proposal) return null;

  proposal.draft = {
    text: draft.draft,
    summary: draft.summary,
    unavailable: draft.unavailable,
    verdict: draft.measurement?.comparison.verdict,
    meanScoreDelta: draft.measurement?.comparison.meanScoreDelta,
    passRateDelta: draft.measurement?.comparison.passRateDelta,
  };

  engineeringEventBus.emit({
    type: 'proposal.draft.attached',
    timestamp: Date.now(),
    source: 'proposal-engine',
    payload: {
      proposalId: id,
      hasDraft: draft.draft !== null,
      measured: draft.measurement !== null,
      verdict: draft.measurement?.comparison.verdict ?? 'unmeasured',
    },
  });

  return proposal;
}

export function listProposals(status?: ProposalStatus): Proposal[] {
  return [...proposals.values()]
    .filter((p) => !status || p.status === status)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getProposal(id: string): Proposal | undefined {
  return proposals.get(id);
}

/**
 * Records a founder decision. This changes the proposal's status and
 * nothing else — approving does not execute the suggested action, and
 * there is no code path here that could.
 */
export function decideProposal(
  id: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Proposal | null {
  const proposal = proposals.get(id);
  if (!proposal) return null;
  if (proposal.status !== 'pending') return proposal;

  proposal.status = decision;
  proposal.decidedAt = Date.now();
  proposal.decisionNote = note;

  engineeringEventBus.emit({
    type: 'proposal.decided',
    timestamp: proposal.decidedAt,
    source: 'proposal-engine',
    payload: { proposalId: id, decision, hasNote: Boolean(note) },
  });

  return proposal;
}
