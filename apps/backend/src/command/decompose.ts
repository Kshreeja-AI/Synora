/**
 * One sentence describing several actions, split into the actions it
 * describes — deterministically, locally, with no model involved.
 *
 * People do not speak in single commands. "Find the Q3 report, summarize it,
 * and schedule the digest every Monday" is one sentence and three requests,
 * and a layer that treats it as one indivisible action either does a
 * fraction of what was asked or refuses something it could largely serve.
 *
 * THE GOVERNING BIAS OF THIS FILE: under-split, never over-split.
 *
 * The two failure directions are not symmetrical. Merging two actions into
 * one means Synora recognizes fewer things than were asked — visible
 * immediately, and nothing wrong happens, because the merged text routes to
 * one capability and the rest of the sentence is inert. INVENTING an action
 * that was never requested means Synora acts on its own fabrication. So
 * every rule here refuses to split unless the segment independently reads as
 * an action, and "sales, marketing, and support" stays one subject rather
 * than becoming three imaginary steps.
 *
 * WHY NOT A MODEL. Same three reasons the understander is not a model, and
 * one more that is specific to decomposition: a model asked to split a
 * hostile sentence can be persuaded to split it favourably — hiding a
 * dangerous action inside a segment that reads as harmless. A fixed splitter
 * cannot be argued with, and every segment it produces is independently
 * re-examined by the same grammar and the same policy.
 */

import { understandCommand } from './understand';

/**
 * Words that make a segment an ACTION rather than a continuation.
 *
 * Deliberately WIDER than what Synora can do — it includes `send`, `delete`,
 * `pay`, `call`. Recognizing that an action was requested is a different
 * question from being able to perform it, and conflating them is how a step
 * disappears: absorbed into its neighbour's subject, leaving a person told
 * "I understood 3 actions" when they asked for 4. A segment recognized here
 * but unroutable becomes an honest step that says Synora cannot do it,
 * which is the answer the person actually needs.
 */
const ACTION_WORDS: ReadonlySet<string> = new Set([
  // Things Synora can route today.
  'find', 'search', 'locate', 'look', 'show', 'list',
  'create', 'make', 'draft', 'write', 'generate', 'design', 'compose', 'start',
  'summarize', 'summarise', 'explain', 'describe', 'tell', 'answer',
  'schedule', 'automate', 'repeat',
  'preview', 'plan', 'outline',
  'monitor', 'check', 'review', 'watch',
  'invite',
  'run', 'execute', 'trigger', 'fire',
  // Things Synora cannot do yet. Present ON PURPOSE — see the comment above.
  'send', 'email', 'mail', 'message', 'notify', 'share', 'forward', 'reply',
  'delete', 'remove', 'archive', 'purge', 'wipe',
  'export', 'download', 'upload', 'publish', 'post',
  'call', 'phone', 'text',
  'pay', 'purchase', 'buy', 'transfer', 'refund',
  'translate', 'analyze', 'analyse', 'compare',
  'open', 'close', 'update', 'rename', 'move', 'copy', 'assign', 'remind',
  'approve', 'reject', 'cancel', 'book', 'reserve',
]);

/** Discourse words that introduce a step without being part of it. */
const LEADING_CONNECTIVES: ReadonlySet<string> = new Set([
  'then', 'also', 'next', 'finally', 'afterwards', 'after', 'and', 'plus',
  'please', 'now', 'lastly', 'additionally', 'subsequently',
]);

/**
 * Phrases that make a step depend on the one before it.
 *
 * A back-reference is the only evidence a sentence gives that one action
 * consumes another's output. "Summarize IT" cannot start until something is
 * found; "schedule the digest every Monday" refers to nothing and can be
 * done independently — which is exactly how a person means it.
 *
 * Conservative on purpose in the same direction as the splitter: a missed
 * dependency runs two things in an order that was not required, while an
 * INVENTED dependency blocks an independent action behind an unrelated one
 * and can strand it forever if that unrelated one fails.
 */
const BACK_REFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(it|them|that|this|those|these)\b/i,
  /\bthe\s+(result|results|output|outputs|summary|findings|response|answer)\b/i,
];

/**
 * More segments than this from one sentence is not a plan — it is a parse
 * that has lost the thread. Refusing is honest; presenting twelve confident
 * steps derived from a runaway split is not.
 */
export const MAX_PLAN_STEPS = 8;

export interface DecomposedStep {
  /** 1-based, the order a person reads. */
  index: number;
  /** The segment's own words, verbatim — never Synora's paraphrase. */
  text: string;
  /**
   * Which test made this a step.
   *
   * Load-bearing for honesty downstream, not diagnostics. A segment split
   * out by the LEXICON ("send the summary to the CFO") was recognized as an
   * action Synora simply cannot perform. If the planner then reported the
   * grammar's generic "I could not tell what you wanted me to do", it would
   * blame the person's phrasing for Synora's missing capability — and they
   * would rewrite a perfectly clear sentence forever.
   */
  recognizedAs: 'grammar' | 'action-word';
  /**
   * Indices of steps whose output this one consumes. Empty for an
   * independent step. Only ever the immediately preceding step today:
   * claiming a longer chain would require inferring which earlier output
   * was meant, and a wrong guess there silently reorders someone's work.
   */
  dependsOn: number[];
}

export type Decomposition =
  | { status: 'decomposed'; steps: DecomposedStep[] }
  /** The sentence describes more actions than can be planned coherently. */
  | { status: 'too-many-steps'; question: string; found: number };

/** Strip leading discourse words so "then summarize it" starts at "summarize". */
function firstMeaningfulWord(segment: string): string {
  const words = segment
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    if (!LEADING_CONNECTIVES.has(word)) return word;
  }
  return '';
}

/**
 * Whether this segment stands on its own as a request.
 *
 * Two independent ways to qualify, because either alone is too narrow:
 * the lexicon catches imperatives the grammar has no rule for ("send the
 * summary"), and the grammar catches phrasings that do not begin with a
 * verb at all ("what happened yesterday"). A segment that satisfies
 * NEITHER is a continuation of its neighbour, not a step.
 */
function classifySegment(segment: string): 'grammar' | 'action-word' | null {
  // Grammar first: when the understander recognizes the sentence, that is
  // the stronger signal and the one that says a capability may exist.
  if (understandCommand(segment).intent !== 'unrecognized') return 'grammar';
  if (ACTION_WORDS.has(firstMeaningfulWord(segment))) return 'action-word';
  return null;
}

/**
 * Cut points: commas, semicolons, and the coordinating words people use to
 * chain requests. Applied to the ORIGINAL text so each segment keeps its own
 * wording — a schedule phrase ("every Monday at 9am Asia/Kolkata") has to
 * survive intact for the parser that reads it later.
 */
function rawSegments(text: string): string[] {
  return text
    .split(/[;,]|\s+\bthen\b\s+|\s+\band\s+then\b\s+|\s+\band\b\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Split one command into the actions it describes.
 *
 * Pure and deterministic: same sentence, same steps, forever. Never throws
 * on hostile input, and never contacts anything.
 */
export function decomposeCommand(rawInput: string): Decomposition {
  const text = typeof rawInput === 'string' ? rawInput.trim().replace(/\s+/g, ' ') : '';
  if (text.length === 0) {
    return { status: 'decomposed', steps: [] };
  }

  const segments = rawSegments(text);

  // Merge non-action segments BACKWARD into the step they belong to, so a
  // list of nouns stays a subject. The separator is restored as a comma
  // rather than the original punctuation: reconstructing exact punctuation
  // would need a token-level parse this file deliberately does not have,
  // and a comma is the reading that never changes which action is meant.
  const merged: { text: string; recognizedAs: 'grammar' | 'action-word' }[] = [];
  for (const segment of segments) {
    const classification = classifySegment(segment);
    if (merged.length > 0 && classification === null) {
      merged[merged.length - 1].text = `${merged[merged.length - 1].text}, ${segment}`;
      continue;
    }
    // A leading segment that qualifies as neither is still the request: the
    // first thing said is what was asked, however it was phrased, and the
    // understander gets to say what it makes of it.
    merged.push({ text: segment, recognizedAs: classification ?? 'grammar' });
  }

  if (merged.length > MAX_PLAN_STEPS) {
    return {
      status: 'too-many-steps',
      found: merged.length,
      question: `That reads as ${merged.length} separate actions, which is more than I can plan as one request. Try asking for up to ${MAX_PLAN_STEPS} at a time.`,
    };
  }

  const steps: DecomposedStep[] = merged.map((segment, position) => {
    const index = position + 1;
    const referencesEarlier =
      position > 0 && BACK_REFERENCE_PATTERNS.some((pattern) => pattern.test(segment.text));
    return {
      index,
      text: segment.text,
      recognizedAs: segment.recognizedAs,
      dependsOn: referencesEarlier ? [index - 1] : [],
    };
  });

  return { status: 'decomposed', steps };
}
