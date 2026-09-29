/**
 * Scores an output's quality by asking an AI to judge it against stated
 * criteria.
 *
 * WHY THIS IS NOT A GRADER. The grader contract is deliberately a pure
 * synchronous function, so that a run is reproducible and a score change
 * always means the output changed rather than the ruler moving. An AI judge
 * is neither pure nor deterministic: ask it twice and it may answer
 * differently. Forcing it into the grader registry would quietly destroy the
 * property the whole evaluation platform rests on — that two runs are
 * comparable. So a judgement is a separate dimension, reported alongside
 * grader scores and never merged into them.
 *
 * PROVENANCE. Every judgement is marked `judged`, in the same way a
 * table-derived cost is marked `stated`. A judged score is an opinion from a
 * fallible model, not a measurement, and the two must never become
 * indistinguishable in a report someone acts on.
 *
 * FAIL-OPEN ON ABSENCE, DELIBERATELY. Elsewhere this platform fails closed:
 * an unknown grader scores zero, because asking for a rule that does not
 * exist is a specification error and silently skipping it would inflate
 * results. An absent judge is a different thing — a capability that was
 * never configured. Scoring zero for it would mark good outputs as bad and
 * make every unjudged run look like a quality collapse. So an unjudged
 * output scores `null`, with the reason attached: not judged, as distinct
 * from judged poorly.
 */

export type Judge = (request: {
  /** What the model produced. */
  output: string;
  /** What "good" means for this case, in plain language. */
  criteria: string;
  /** The original input, where the judge needs it for context. */
  input?: string;
  /** A reference answer, where one exists. */
  expected?: string;
}) => Promise<{ score: number; reasoning?: string }>;

export interface Judgement {
  /** 0..1, or null when no judgement could be obtained. Null is not zero. */
  score: number | null;
  criteria: string;
  /** Always 'judged' — an opinion from a model, never a measurement. */
  provenance: 'judged';
  /** Why there is no score. Absent when one was obtained. */
  unavailable?: string;
  /** The judge's stated reasoning, when it supplied any. */
  reasoning?: string;
}

let judge: Judge | null = null;

/**
 * Supplies the judge. Left unset, judgements are unavailable and say so —
 * the correct behaviour before any AI credentials exist.
 */
export function configureJudge(next: Judge | null): void {
  judge = next;
}

export function isJudgeConfigured(): boolean {
  return judge !== null;
}

export function resetJudge(): void {
  judge = null;
}

export async function judgeOutput(params: {
  output: string;
  criteria: string;
  input?: string;
  expected?: string;
}): Promise<Judgement> {
  const base = { criteria: params.criteria, provenance: 'judged' as const };

  if (!judge) {
    return {
      ...base,
      score: null,
      unavailable: 'No judge is configured, so quality was not assessed. This is an absent measurement, not a poor result.',
    };
  }

  let raw: { score: number; reasoning?: string };
  try {
    raw = await judge(params);
  } catch (err) {
    return {
      ...base,
      score: null,
      unavailable: `The judge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // A judge returning 7, or NaN, is malfunctioning. Clamping would hide
  // that behind a plausible number; rejecting it surfaces the fault.
  if (typeof raw?.score !== 'number' || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 1) {
    return {
      ...base,
      score: null,
      unavailable: `The judge returned an out-of-range score (${String(raw?.score)}), so it was discarded.`,
      reasoning: raw?.reasoning,
    };
  }

  return { ...base, score: raw.score, reasoning: raw.reasoning };
}

export interface JudgedSummary {
  /** Mean over judged outputs only. Null when nothing could be judged. */
  meanScore: number | null;
  judged: number;
  /**
   * Outputs no judgement was obtained for. Reported rather than folded into
   * the mean as zeros, which would drag quality down for a reason that has
   * nothing to do with quality.
   */
  unjudged: number;
  provenance: 'judged';
  /** The distinct reasons judgements were unavailable. */
  unavailableReasons: string[];
}

export function summariseJudgements(judgements: Judgement[]): JudgedSummary {
  const scored = judgements.filter((j) => j.score !== null);
  const reasons = new Set(
    judgements.filter((j) => j.unavailable).map((j) => j.unavailable as string),
  );

  return {
    meanScore:
      scored.length > 0 ? scored.reduce((sum, j) => sum + (j.score as number), 0) / scored.length : null,
    judged: scored.length,
    unjudged: judgements.length - scored.length,
    provenance: 'judged',
    unavailableReasons: [...reasons],
  };
}
