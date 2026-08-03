import { runEvaluation, compareRuns, type CaseExecutor, type EvaluationRunResult, type RunComparison } from './evaluation-runner.js';
import { getCases } from './evaluation-datasets.js';

/**
 * Drafts a candidate revision of a prompt and measures it against the real
 * captured failures, so a proposal can arrive with a before-and-after
 * rather than a suggestion.
 *
 * GOVERNANCE — this module writes text and measures text. That is all.
 *
 * It has no access to the running product's prompts. It cannot read them,
 * cannot write them, and has no code path that could. A draft is a string
 * attached to a proposal, and a proposal is an inert record that waits for
 * founder approval. Nothing here reaches production, and that is enforced
 * structurally: this file imports the evaluation runner and the case
 * library, and nothing else.
 *
 * FAIL-CLOSED. Both capabilities are injected and both are optional:
 *
 * - Without a drafter, no draft is produced. It does not fall back to
 *   inventing a revision, because a made-up prompt presented as a
 *   suggestion is worse than no suggestion.
 * - Without an executor, no measurement is produced. It does not report an
 *   unmeasured draft as an improvement, because "we wrote something" and
 *   "we proved something is better" are entirely different claims.
 *
 * Each missing capability is reported by name, so the reason a draft is
 * absent is visible rather than looking like nothing was worth suggesting.
 */

/**
 * Produces a candidate prompt. Injected, so this module never knows which
 * provider or model wrote the draft — the same principle that keeps the
 * evaluation runner provider-agnostic.
 */
export type Drafter = (request: {
  promptId: string;
  /** The failing inputs and outputs the revision needs to handle better. */
  failures: Array<{ input: string; output: string }>;
}) => Promise<string>;

export interface DraftMeasurement {
  baselineRun: EvaluationRunResult;
  candidateRun: EvaluationRunResult;
  comparison: RunComparison;
}

export interface DraftResult {
  promptId: string;
  datasetId: string;
  /** The suggested prompt text, or null when no drafter was configured. */
  draft: string | null;
  /** Present only when both the draft and an executor existed. */
  measurement: DraftMeasurement | null;
  /**
   * Why a draft or its measurement is missing. Empty when everything ran.
   * Absence with a stated reason is a result; silent absence is a mystery.
   */
  unavailable: string[];
  /**
   * A plain reading of the comparison, or a statement that none was
   * possible. Never claims improvement without a measured comparison.
   */
  summary: string;
}

let drafter: Drafter | null = null;
let baselineExecutor: CaseExecutor | null = null;
let candidateExecutorFactory: ((draft: string) => CaseExecutor) | null = null;

/**
 * Supplies the capabilities. Left unset, the generator produces nothing and
 * says why — the correct behaviour before any AI credentials exist.
 */
export function configureDraftGenerator(config: {
  drafter?: Drafter | null;
  /** Runs a case against the prompt currently in use, for the "before" figure. */
  baselineExecutor?: CaseExecutor | null;
  /** Builds an executor that runs a case against the drafted prompt. */
  candidateExecutorFactory?: ((draft: string) => CaseExecutor) | null;
}): void {
  if (config.drafter !== undefined) drafter = config.drafter;
  if (config.baselineExecutor !== undefined) baselineExecutor = config.baselineExecutor;
  if (config.candidateExecutorFactory !== undefined) {
    candidateExecutorFactory = config.candidateExecutorFactory;
  }
}

export function resetDraftGenerator(): void {
  drafter = null;
  baselineExecutor = null;
  candidateExecutorFactory = null;
}

function describe(comparison: RunComparison): string {
  const score = `mean score ${comparison.meanScoreDelta >= 0 ? '+' : ''}${comparison.meanScoreDelta.toFixed(2)}`;
  const cases = `${comparison.improved.length} case(s) better, ${comparison.regressed.length} worse, ${comparison.unchanged.length} unchanged`;

  switch (comparison.verdict) {
    case 'improvement':
      return `The draft scored better on the captured failures (${score}; ${cases}).`;
    case 'regression':
      return `The draft scored worse than the prompt in use (${score}; ${cases}). It is reported anyway, because suppressing unfavourable results would make every reported draft meaningless.`;
    case 'mixed':
      return `The draft helped some cases and hurt others (${score}; ${cases}). This is not a clear win and should not be treated as one.`;
    case 'no-change':
      return `The draft scored identically to the prompt in use (${cases}). No evidence it helps.`;
    default:
      return 'The two runs could not be compared, so nothing can be concluded from them.';
  }
}

/**
 * Drafts a revision for one prompt and measures it against a dataset of that
 * prompt's captured failures.
 */
export async function generateDraft(params: {
  promptId: string;
  datasetId: string;
  /** Cases carrying this tag are treated as this prompt's failures. */
  caseTag?: string;
}): Promise<DraftResult> {
  const unavailable: string[] = [];
  const tag = params.caseTag ?? `prompt:${params.promptId}`;
  const cases = getCases(params.datasetId, { tag });

  if (cases.length === 0) {
    return {
      promptId: params.promptId,
      datasetId: params.datasetId,
      draft: null,
      measurement: null,
      unavailable: ['No captured failing cases for this prompt, so there is nothing to draft against.'],
      summary: 'No draft was attempted: a revision written without seeing the failures it must fix would be guesswork.',
    };
  }

  if (!drafter) {
    return {
      promptId: params.promptId,
      datasetId: params.datasetId,
      draft: null,
      measurement: null,
      unavailable: ['No drafter is configured, so no candidate prompt was written.'],
      summary:
        'No draft was produced. This is a missing capability, not a judgement that the prompt is fine.',
    };
  }

  let draft: string;
  try {
    draft = await drafter({
      promptId: params.promptId,
      failures: cases.map((c) => ({ input: c.input, output: c.actualOutput ?? '' })),
    });
  } catch (err) {
    return {
      promptId: params.promptId,
      datasetId: params.datasetId,
      draft: null,
      measurement: null,
      unavailable: [`Drafting failed: ${err instanceof Error ? err.message : String(err)}`],
      summary: 'No draft was produced because drafting itself failed.',
    };
  }

  if (!baselineExecutor || !candidateExecutorFactory) {
    if (!baselineExecutor) unavailable.push('No baseline executor, so the prompt in use could not be measured.');
    if (!candidateExecutorFactory) unavailable.push('No candidate executor, so the draft could not be run.');
    return {
      promptId: params.promptId,
      datasetId: params.datasetId,
      draft,
      measurement: null,
      unavailable,
      // The draft exists but is unproven. Saying so is the whole point.
      summary:
        'A draft was written but never run, so there is no evidence it is better. Treat it as a starting point for review, not as a tested improvement.',
    };
  }

  const baselineRun = await runEvaluation(params.datasetId, baselineExecutor, {
    label: `${params.promptId} (in use)`,
    tag,
  });
  const candidateRun = await runEvaluation(params.datasetId, candidateExecutorFactory(draft), {
    label: `${params.promptId} (draft)`,
    tag,
  });

  if (!baselineRun || !candidateRun) {
    return {
      promptId: params.promptId,
      datasetId: params.datasetId,
      draft,
      measurement: null,
      unavailable: ['The evaluation dataset could not be resolved, so neither run completed.'],
      summary: 'A draft was written but could not be measured.',
    };
  }

  const comparison = compareRuns(baselineRun, candidateRun);

  return {
    promptId: params.promptId,
    datasetId: params.datasetId,
    draft,
    measurement: { baselineRun, candidateRun, comparison },
    unavailable,
    summary: describe(comparison),
  };
}
