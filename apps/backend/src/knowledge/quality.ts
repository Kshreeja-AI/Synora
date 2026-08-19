import { detectExecutableContent, scanForPromptInjection } from './security';
import type {
  KnowledgeConflict,
  KnowledgeFreshness,
  KnowledgeQuality,
  KnowledgeUpdateFrequency,
} from './types';

/**
 * Measurable properties of text, and nothing more.
 *
 * ── THE LINE THIS MODULE DOES NOT CROSS ──────────────────────────────────
 *
 * It does not judge whether content is TRUE, USEFUL, or BIASED. It cannot,
 * and a number that implied it could would be trusted — someone would filter
 * on `qualityScore > 0.8` believing they had filtered for accuracy, when all
 * they had done was filter out documents with unusual line lengths.
 *
 * So every signal here is a fact about the file: how long it is, how much of
 * it is replacement characters, how much repeats, how much is markup. Each
 * one is separately reported alongside the composite, so a caller can see
 * WHICH property is low rather than trusting a single opaque number.
 */

/** U+FFFD. Its presence means bytes were decoded with the wrong encoding. */
const REPLACEMENT_CHAR = '�';

export function assessKnowledgeQuality(text: string): KnowledgeQuality {
  const lengthChars = text.length;
  if (lengthChars === 0) {
    return {
      score: 0,
      lengthChars: 0,
      replacementCharRatio: 0,
      repetitionRatio: 0,
      markupRatio: 0,
      detectedIssues: ['empty document'],
      unusable: true,
    };
  }

  const issues: string[] = [];

  const replacementCount = text.split(REPLACEMENT_CHAR).length - 1;
  const replacementCharRatio = replacementCount / lengthChars;
  if (replacementCharRatio > 0.01) {
    issues.push(
      `${(replacementCharRatio * 100).toFixed(1)}% replacement characters — the source was decoded with the wrong encoding upstream`
    );
  }

  // Repetition across non-trivial lines. Boilerplate headers, navigation
  // chrome and scraper artefacts all show up here, and a document that is
  // mostly one repeated line embeds to noise.
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 20);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of lines) {
    if (seen.has(line)) duplicates++;
    else seen.add(line);
  }
  const repetitionRatio = lines.length > 0 ? duplicates / lines.length : 0;
  if (repetitionRatio > 0.3) {
    issues.push(`${(repetitionRatio * 100).toFixed(0)}% of substantial lines are verbatim repeats`);
  }

  // Residual markup. The pipeline strips it, so a high ratio here means the
  // stripper was bypassed or the content is not really prose.
  const markupChars = (text.match(/<[^>]{1,200}>/g) ?? []).join('').length;
  const markupRatio = markupChars / lengthChars;
  if (markupRatio > 0.05) {
    issues.push(`${(markupRatio * 100).toFixed(0)}% of the document is markup, not prose`);
  }

  if (lengthChars < 200) {
    issues.push('very short document — likely a stub or an extraction failure');
  }

  const executable = detectExecutableContent(text);
  if (executable.length > 0) {
    issues.push(`executable content present: ${executable.join(', ')}`);
  }

  const injection = scanForPromptInjection(text);
  if (injection.detected) {
    // Recorded as an ISSUE, not a refusal. See `security.ts` — the fence is
    // the defence; this is the label, and the label is what lets an operator
    // notice a source that has started producing them.
    issues.push(`instruction-shaped text detected: ${injection.signatures.join(', ')}`);
  }

  let score = 1;
  score -= Math.min(0.5, replacementCharRatio * 50);
  score -= Math.min(0.3, repetitionRatio);
  score -= Math.min(0.2, markupRatio * 4);
  if (lengthChars < 200) score -= 0.2;
  if (executable.length > 0) score -= 0.3;

  // `unusable` is deliberately narrow: only structural faults that make the
  // TEXT worthless. Instruction-shaped content is not one of them — a
  // document about prompt injection is a legitimate document.
  const unusable =
    replacementCharRatio > 0.2 || repetitionRatio > 0.9 || markupRatio > 0.5 || executable.length > 0;

  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
    lengthChars,
    replacementCharRatio: Number(replacementCharRatio.toFixed(6)),
    repetitionRatio: Number(repetitionRatio.toFixed(4)),
    markupRatio: Number(markupRatio.toFixed(4)),
    detectedIssues: issues,
    unusable,
  };
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * FRESHNESS
 * ═══════════════════════════════════════════════════════════════════════ */

/** How long a source's own update cadence allows before content is aging. */
const FRESHNESS_WINDOW_DAYS: Readonly<Record<KnowledgeUpdateFrequency, number | null>> = {
  // A static source never goes stale by age — a public-domain novel from
  // 1847 is exactly as current as it will ever be, and calling it "stale"
  // would be a category error rather than a warning.
  static: null,
  yearly: 730,
  monthly: 120,
  weekly: 30,
  daily: 7,
  continuous: 2,
};

/**
 * Age relative to what the source PROMISES, not to an absolute calendar.
 *
 * A monthly dataset three weeks old is fresh; a continuously-updated feed
 * three weeks old is stale. One threshold for both would be wrong for both.
 *
 * `now` is a parameter because this module never reads a clock — the same
 * inputs must always produce the same answer, or a freshness figure cannot be
 * reproduced in a test or explained in an audit.
 */
export function assessFreshness(input: {
  publishedAt?: string;
  ingestedAt: string;
  updateFrequency: KnowledgeUpdateFrequency;
  now: string;
}): KnowledgeFreshness {
  const window = FRESHNESS_WINDOW_DAYS[input.updateFrequency];
  const base = { ingestedAt: input.ingestedAt, updateFrequency: input.updateFrequency };

  if (!input.publishedAt) {
    // UNDATED IS NOT FRESH AND NOT STALE. Inventing a date from the
    // ingestion timestamp would make every document look as current as the
    // day Synora happened to read it.
    return {
      ...base,
      ageDays: null,
      staleness: 'unknown',
      reason: 'the source published no date, so age cannot be established and is not guessed',
    };
  }

  const published = Date.parse(input.publishedAt);
  const now = Date.parse(input.now);
  if (Number.isNaN(published) || Number.isNaN(now)) {
    return {
      ...base,
      publishedAt: input.publishedAt,
      ageDays: null,
      staleness: 'unknown',
      reason: 'the publication date could not be parsed',
    };
  }

  const ageDays = Math.max(0, Math.floor((now - published) / 86_400_000));

  if (window === null) {
    return {
      ...base,
      publishedAt: input.publishedAt,
      ageDays,
      staleness: 'fresh',
      reason: `this source is static, so its content does not age (${ageDays} days old)`,
    };
  }

  const staleness = ageDays <= window / 2 ? 'fresh' : ageDays <= window ? 'aging' : 'stale';
  return {
    ...base,
    publishedAt: input.publishedAt,
    ageDays,
    staleness,
    reason: `${ageDays} days old against a ${input.updateFrequency} source's ${window}-day window`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * CONFLICTS
 * ═══════════════════════════════════════════════════════════════════════ */

/** Numbers, dates and quantities — the claims that actually collide. */
const FACT_PATTERN = /(?:^|\s)(-?\d[\d,]*(?:\.\d+)?)\s*(%|percent|million|billion|km|kg|°C|years?)?/gi;

interface FactualClaim {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly subject: string;
  readonly value: string;
}

/**
 * Report passages from DIFFERENT sources that state different numbers about
 * the same subject.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
 *
 * Resolve them. Not by trust level, not by recency, not by majority. This
 * module cannot know which source is right, and a system that picked one
 * would manufacture confidence out of a genuine disagreement — which is
 * worse than no citation at all, because the reader now has a number AND a
 * source and no reason to doubt either.
 *
 * ── AND IT IS DELIBERATELY CRUDE ─────────────────────────────────────────
 *
 * Subject matching is a normalised keyword overlap, not semantics. It will
 * miss conflicts phrased differently and will occasionally flag two
 * compatible statements. Both failure modes are acceptable BECAUSE the output
 * is a report and not a decision: a false positive costs a line of "these
 * sources may disagree", and nothing is discarded on its say-so.
 */
export function detectConflicts(
  passages: readonly { chunkId: string; sourceId: string; text: string }[]
): readonly KnowledgeConflict[] {
  const claims: FactualClaim[] = [];

  for (const passage of passages) {
    for (const sentence of passage.text.split(/(?<=[.!?])\s+/)) {
      const numbers = [...sentence.matchAll(FACT_PATTERN)].map((m) => `${m[1]}${m[2] ?? ''}`.toLowerCase());
      if (numbers.length === 0) continue;
      const subject = subjectKey(sentence);
      if (subject.length === 0) continue;
      for (const value of numbers) {
        claims.push({ chunkId: passage.chunkId, sourceId: passage.sourceId, subject, value });
      }
    }
  }

  const bySubject = new Map<string, FactualClaim[]>();
  for (const claim of claims) {
    const list = bySubject.get(claim.subject) ?? [];
    list.push(claim);
    bySubject.set(claim.subject, list);
  }

  const conflicts: KnowledgeConflict[] = [];
  for (const [subject, group] of bySubject) {
    const sources = new Set(group.map((c) => c.sourceId));
    const values = new Set(group.map((c) => c.value));
    // BOTH conditions: one source contradicting itself across two passages is
    // usually two different measurements, not a conflict worth reporting.
    if (sources.size < 2 || values.size < 2) continue;

    conflicts.push({
      chunkIds: [...new Set(group.map((c) => c.chunkId))],
      sourceIds: [...sources],
      reason:
        `sources disagree on "${subject}": ${[...values].join(' vs ')}. ` +
        'Reported, not resolved — Synora cannot know which is correct.',
    });
  }

  return conflicts;
}

/** The content words of a sentence, sorted, as a crude subject fingerprint. */
function subjectKey(sentence: string): string {
  const STOP = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to', 'for',
    'and', 'or', 'by', 'with', 'about', 'as', 'from', 'that', 'this', 'it', 'its', 'has',
    'have', 'had', 'been', 'be', 'than', 'about', 'approximately', 'over', 'under', 'per',
  ]);
  return [
    ...new Set(
      sentence
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w))
    ),
  ]
    .sort()
    .slice(0, 6)
    .join('|');
}
