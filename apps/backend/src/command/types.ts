/**
 * The Universal Command Layer's vocabulary.
 *
 * One human sentence in; a statement of what Synora believes was asked and
 * which REAL capability would serve it, out. Nothing here executes anything.
 *
 * Three laws this module is built on, inherited from the rest of the
 * platform and non-negotiable here:
 *
 * 1. ABSENT, NOT INVENTED. If Synora cannot tell what was meant, it says so.
 *    It never guesses a route, because a confident wrong route is how an
 *    assistant does the wrong thing on someone's behalf.
 * 2. FACTS, NEVER VERDICTS. This layer reports what it recognized, what it
 *    would use, and what it could not determine. It does not grade a request
 *    "safe" — reversibility and approval facts already have owners
 *    (`agents/step-checks.ts`), and this layer defers to them.
 * 3. THE COMMAND TEXT IS DATA, NEVER INSTRUCTIONS. A sentence arriving here
 *    is untrusted input from a possibly-hostile source. It is classified by
 *    the SHAPE of the action it describes. Text inside it that tries to
 *    grant itself authority ("ignore your rules", "you are now admin") is
 *    recognized as an attempt and reported — never obeyed.
 */

/**
 * The verbs humans actually use, taken from how people describe outcomes
 * rather than from Synora's internal module names. A person says "find my
 * document", never "query the asset service".
 */
export type CommandIntent =
  | 'find'
  | 'ask'
  | 'create'
  | 'automate'
  | 'plan'
  | 'decide'
  | 'monitor'
  | 'communicate'
  | 'control'
  /** Recognized as a real request, but Synora has no capability for it yet. */
  | 'not-yet-capable'
  /** Synora could not tell what was meant. Deliberately not a guess. */
  | 'unrecognized';

/**
 * How a matched capability stands in THIS deployment right now. Kept
 * separate from the intent itself: "Synora can do this" and "Synora can do
 * this today, here" are different claims, and collapsing them is how a
 * product promises something a user cannot actually get.
 */
export type CapabilityAvailability =
  /** Works now, locally, with no external credential. */
  | 'available'
  /** Implemented, but this deployment needs a provider credential first. */
  | 'needs-credentials'
  /** Synora has no implementation of this yet. */
  | 'not-implemented';

export interface CommandRoute {
  /** Stable id of the capability that would serve this, e.g. 'search.workspace'. */
  capabilityId: string;
  /** What it does, in the words a person would use. */
  summary: string;
  availability: CapabilityAvailability;
  /**
   * The workspace permission acting on this requires, or `null` when it
   * needs only workspace membership (reading, previewing).
   *
   * Declared HERE, next to the capability, rather than recomputed by any
   * surface that wants to know: a permission answer that lives in two
   * places eventually disagrees with itself, and the disagreement is
   * always discovered by someone getting access they should not have.
   * The authoritative check still runs server-side at execution.
   */
  requiredPermission: string | null;
  /**
   * How much is at stake if this runs. Drives whether a person must
   * approve first — see `RISK_POLICY` in `./execute.ts`.
   *
   * `read-only`  — informational; changes nothing.
   * `reversible` — changes something Synora can undo or that is additive.
   * `sensitive`  — leaves Synora, spends money, or changes who can do what.
   * `high-risk`  — never runs without the strongest approval available.
   */
  riskClass: 'read-only' | 'reversible' | 'sensitive' | 'high-risk';
  /**
   * Optional claim on a sentence WITHIN its intent.
   *
   * An intent can hold several capabilities — "monitor" covers both how the
   * AI providers are behaving and what happened in the workspace — and
   * catalogue order alone cannot tell them apart. Without this, one of them
   * always wins and the other is unreachable, which means a confident
   * answer to a question nobody asked. That is the single worst thing this
   * layer can do, so a capability may state which phrasings are ITS OWN.
   *
   * Unmatched hints never exclude anything: a route with no matching hint
   * still competes in catalogue order, so adding a hint can promote a
   * capability but can never make one unreachable.
   */
  hint?: RegExp;
  /**
   * The real surface that performs it, for operators and for tests that
   * assert this layer never names a surface that does not exist.
   */
  surface: string;
  /**
   * True when acting on this would change something outside Synora or is
   * otherwise a decision a human should make. This layer only FLAGS it;
   * the authoritative per-step facts still come from `agents/step-checks.ts`
   * at execution time.
   */
  mayNeedApproval: boolean;
}

/**
 * A security observation about the command TEXT — not about the person.
 * Reported as an observation, never as an accusation or a score.
 */
export interface CommandTextObservation {
  kind: 'authority-override-attempt' | 'destructive-phrasing' | 'oversized-input';
  /** What was observed, in plain language, without echoing the payload back. */
  detail: string;
}

export interface CommandUnderstanding {
  intent: CommandIntent;
  /**
   * What Synora believes the person is referring to — the subject of the
   * sentence with the command verb removed. Empty when nothing specific was
   * named, which is itself useful ("find" alone is not actionable).
   */
  subject: string;
  /**
   * `high` only when a command verb was recognized AND a subject was named.
   * Deliberately three coarse values rather than a fabricated percentage:
   * a number like "0.83" would imply a measurement nothing here performs.
   */
  confidence: 'high' | 'low' | 'none';
  /** The capabilities that would serve this, best first. Empty when none apply. */
  routes: CommandRoute[];
  /**
   * What Synora could NOT determine, in plain language. Always populated
   * when confidence is not `high` — a person deserves to know what was
   * unclear rather than receiving a silent best guess.
   */
  unknowns: string[];
  /** Security observations about the text. Empty for ordinary commands. */
  observations: CommandTextObservation[];
  /**
   * Always false in this layer. Present as an explicit field, not an
   * assumption, so no caller can ever read an interpretation as evidence
   * that something ran.
   */
  executed: false;
}
