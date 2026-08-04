import type { Judge } from './ai-judge.js';

/**
 * A judge backed by a real model, through the provider abstraction.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION. This names no vendor. It takes a text
 * generation function — the same `generateText` the rest of the platform
 * calls — so whichever provider is configured serves the judgement. Ollama
 * matters here only because it is the one provider needing no credentials,
 * which makes measuring AI quality possible at zero cost and with no
 * account. That is a deployment fact, not a dependency.
 *
 * WHY PARSING IS THE HARD PART, AND WHERE THE HONESTY LIVES. A model asked
 * for a number between 0 and 1 will sometimes return `0.8`, sometimes
 * `Score: 8/10`, sometimes a paragraph of praise with no number, sometimes
 * a refusal. Every one of those is a real response.
 *
 * The temptation is to coerce: treat an unparseable answer as 0, or reach
 * for the first digit in the text. Both manufacture data. A 0 says "the
 * model judged this output bad", which is a claim about the output; an
 * unparseable response says "we do not know what the judge thought", which
 * is a claim about the judgement. Collapsing them would make a judge that
 * is malfunctioning look like a product that is failing — and the whole
 * point of this platform is that those two must never be confused.
 *
 * So parsing is strict, and anything it cannot read with confidence
 * *throws*, which `judgeOutput` already converts into a null score with the
 * reason attached. Unavailable, not zero.
 */

export interface ModelJudgeOptions {
  /**
   * The text generation entry point. Injected rather than imported so this
   * module has no dependency on provider wiring, and so tests exercise the
   * real parsing against fabricated model responses.
   */
  generate: (request: {
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
  /**
   * Temperature 0 by default. A judge is not being asked to be creative,
   * and lower variance means two runs of the same evaluation are closer to
   * comparable — though never actually deterministic, which is exactly why
   * a judgement is reported as `judged` rather than measured.
   */
  temperature?: number;
  maxTokens?: number;
}

/**
 * The instruction given to the judge.
 *
 * It demands a bare decimal and nothing else, because every additional
 * degree of freedom in the output format is a new way for parsing to fail.
 * It also explicitly permits refusal: a judge that cannot assess something
 * should say so rather than guess, and `UNSCORABLE` gives it a way to do
 * that which the parser understands.
 */
export const JUDGE_SYSTEM_PROMPT = [
  'You grade the quality of an AI assistant output against stated criteria.',
  'Reply with a single decimal number between 0 and 1, and nothing else.',
  '1 means the output fully satisfies the criteria; 0 means it does not satisfy them at all.',
  'If the criteria cannot be applied to this output, reply with exactly: UNSCORABLE',
  'Do not explain. Do not add punctuation, units, percentages, or any other text.',
].join('\n');

export function buildJudgePrompt(request: {
  output: string;
  criteria: string;
  input?: string;
  expected?: string;
}): string {
  const parts = [`CRITERIA:\n${request.criteria}`];
  if (request.input !== undefined) parts.push(`INPUT GIVEN TO THE ASSISTANT:\n${request.input}`);
  if (request.expected !== undefined) parts.push(`REFERENCE ANSWER:\n${request.expected}`);
  parts.push(`ASSISTANT OUTPUT TO GRADE:\n${request.output}`);
  parts.push('Score:');
  return parts.join('\n\n');
}

/**
 * Reads a score from a model's reply, or refuses.
 *
 * Accepts a bare decimal (`0.8`, `1`, `.75`) and an explicit percentage
 * (`80%`), because those are unambiguous. It deliberately does NOT accept
 * a number buried in prose: "this is a solid 8 out of 10 effort" contains
 * `8`, and reading that as 8.0 — or as 0.8 by guessing the scale — is
 * exactly the kind of confident wrong answer this platform exists to avoid.
 *
 * Throws rather than returning a sentinel. The caller turns that into an
 * unavailable judgement with the reason attached.
 */
export function parseJudgeScore(reply: string): number {
  const trimmed = reply.trim();

  if (trimmed.length === 0) {
    throw new Error('judge returned an empty reply');
  }
  if (/^unscorable$/i.test(trimmed)) {
    throw new Error('judge declined to score: criteria not applicable to this output');
  }

  const percent = /^(\d{1,3}(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (percent) {
    const value = Number(percent[1]) / 100;
    if (value > 1) throw new Error(`judge returned an out-of-range percentage: ${trimmed}`);
    return value;
  }

  // Anchored at both ends: a number surrounded by prose is not a score.
  const decimal = /^(\d*\.?\d+)$/.exec(trimmed);
  if (!decimal) {
    throw new Error(
      `judge reply was not a bare score: ${JSON.stringify(trimmed.slice(0, 80))}`,
    );
  }

  const value = Number(decimal[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`judge returned a non-finite score: ${trimmed}`);
  }
  if (value < 0 || value > 1) {
    // A 0..10 or 0..100 reply is a real possibility, and rescaling it would
    // be a guess about which scale the model used. Refuse instead.
    throw new Error(
      `judge returned ${value}, outside 0..1 — the scale is ambiguous, so this is not scored`,
    );
  }
  return value;
}

/** Builds a judge that asks a real model. Wire with `configureJudge`. */
export function createModelJudge(options: ModelJudgeOptions): Judge {
  const { generate, temperature = 0, maxTokens = 16 } = options;

  return async (request) => {
    const result = await generate({
      prompt: buildJudgePrompt(request),
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      temperature,
      // A score is a handful of characters. Capping hard makes a rambling
      // reply fail fast and cheaply rather than paying for a paragraph
      // that parsing will refuse anyway.
      maxTokens,
    });

    return {
      score: parseJudgeScore(result.text),
      // The raw reply is kept as reasoning so an operator can see what the
      // judge actually said, including when it said something unusable.
      reasoning: result.text.trim().slice(0, 500) || undefined,
    };
  };
}
