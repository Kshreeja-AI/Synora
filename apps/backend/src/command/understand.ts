import { routesForIntent } from './capabilities';
import { isRunnableHere, unavailableReason } from './availability';
import type {
  CommandIntent,
  CommandTextObservation,
  CommandUnderstanding,
} from './types';

/**
 * Synora's own command understanding. Deterministic, local, and dependent on
 * no provider whatsoever.
 *
 * WHY THIS IS NOT A MODEL CALL. Three reasons, in order of importance:
 *
 * 1. SAFETY. A model asked to interpret a hostile sentence can be talked
 *    into interpreting it favourably — that is what prompt injection is.
 *    A fixed grammar cannot be argued with. The first thing standing
 *    between a hostile sentence and Synora's capabilities should not be
 *    something persuadable.
 * 2. AVAILABILITY. Understanding "show me what needs my decision" must work
 *    when every provider is down, unconfigured, or rate-limited. The command
 *    layer is how a person reaches Synora; it cannot inherit the fragility
 *    of the thing they are trying to reach.
 * 3. HONESTY. A deterministic classifier that fails to recognize a sentence
 *    says so. A model always produces something, and its something is
 *    indistinguishable in shape from a correct answer.
 *
 * A model may LATER improve this — ranking candidates, handling phrasing this
 * grammar misses — but it must never become required for the layer to work.
 * That is the same rule the agent runtime already follows with its
 * deterministic local planner.
 */

/** Longer than any genuine command; beyond this the text is not a command. */
const MAX_COMMAND_LENGTH = 2_000;

/**
 * Phrasings that attempt to grant the text itself authority. These are
 * OBSERVED AND REPORTED, never obeyed — but the structural protection is
 * that this module has no mechanism to obey anything: it classifies shapes
 * and returns a description. Detection exists so a hostile attempt becomes
 * visible to operators instead of silently classifying as an ordinary
 * request.
 */
const AUTHORITY_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(all\s+|any\s+|your\s+|the\s+)?(previous|prior|earlier|above)\b/i,
  /\bdisregard\s+(all\s+|any\s+|your\s+|the\s+)?(previous|prior|rules|instructions)\b/i,
  /\byou\s+are\s+now\s+(an?\s+)?(admin|administrator|root|superuser|owner)\b/i,
  /\b(bypass|skip|override)\s+(the\s+)?(approval|permission|security|policy|auth)/i,
  /\bwithout\s+(asking|approval|permission|confirmation)\b/i,
  /\bpretend\s+(you\s+are|to\s+be)\b/i,
  /\bsystem\s*prompt\b/i,
];

/**
 * Phrasings describing irreversible or wide-blast-radius actions. Flagged so
 * a command surface can put consequences in front of a person BEFORE they
 * act — the same reasoning as the reversibility facts already attached to
 * agent steps and tool previews. This is a FACT about the wording, not a
 * verdict about the person or a refusal.
 */
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\b(delete|remove|wipe|erase|destroy|drop)\s+(all|every|everything|the\s+database|production)/i,
  /\b(delete|wipe|erase)\s+(my|our|the)\s+(account|workspace|data|files|history)\b/i,
  /\brevoke\s+(all|every)\b/i,
  /\bshut\s*down\b/i,
];

/**
 * Real human requests Synora genuinely cannot serve. Recognizing these is a
 * feature: "Synora cannot do this yet" is a far better answer than routing a
 * phone call to a text search and returning nothing useful.
 */
const NOT_YET_CAPABLE_PATTERNS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\b(call|phone|ring)\s+(him|her|them|my|the)\b/i, what: 'placing phone calls' },
  { pattern: /\b(text|sms|whatsapp)\s+(him|her|them|my)\b/i, what: 'sending text messages' },
  { pattern: /\bpost\s+(this|it|to)\s*(on|to)?\s*(twitter|x|instagram|facebook|linkedin|tiktok|youtube)?\b/i, what: 'publishing to social platforms' },
  { pattern: /\b(pay|purchase|buy|transfer)\s+(the|for|\$|money|invoice)/i, what: 'making payments' },
  { pattern: /\b(turn|switch)\s+(on|off)\s+(the|my)\b/i, what: 'controlling physical devices' },
  { pattern: /\b(book|reserve)\s+(a|my|the)\s+(flight|hotel|table|ticket)/i, what: 'booking travel' },
];

/**
 * Intent rules, evaluated IN ORDER — first match wins. Order encodes real
 * ambiguity in human phrasing rather than pretending none exists:
 *
 * - `decide` precedes `find`, because "show me what needs my decision" is a
 *   request for the approval queue, not a text search for the word "decision".
 * - `automate` precedes `create`, because "every Monday create a report"
 *   is a request for a schedule, and treating it as a one-off creation would
 *   quietly do a fraction of what was asked.
 * - `plan` precedes `control`, because "what would happen if you run this"
 *   is emphatically not a request to run it.
 */
const INTENT_RULES: readonly { intent: CommandIntent; pattern: RegExp }[] = [
  // Decide — the approval queue.
  { intent: 'decide', pattern: /\b(needs?|requires?|waiting\s+for)\s+(my\s+|your\s+)?(decision|approval|attention|sign[- ]?off)\b/i },
  { intent: 'decide', pattern: /\bwhat\s+(should|do)\s+i\s+(decide|approve)\b/i },
  { intent: 'decide', pattern: /\b(pending|outstanding)\s+approvals?\b/i },

  // Automate — recurrence, before one-off creation.
  { intent: 'automate', pattern: /\bevery\s+(day|morning|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|month|hour)\b/i },
  { intent: 'automate', pattern: /\b(automate|automatically|on\s+a\s+schedule|recurring|schedule)\b/i },
  { intent: 'automate', pattern: /\bwhenever\s+\w+/i },

  // Plan — before control, so previewing is never mistaken for doing.
  { intent: 'plan', pattern: /\b(what\s+would\s+(happen|you\s+do)|preview|dry[- ]?run|before\s+(you\s+)?run)\b/i },
  { intent: 'plan', pattern: /\b(plan|outline)\s+(the|my|a|this)\b/i },

  // Monitor.
  // `what (has recently) happened` / `what's been happening`: people put
  // words between "what" and the verb, and a grammar that only accepts the
  // shortest phrasing refuses the way most people actually ask.
  { intent: 'monitor', pattern: /\b(how\s+(is|are)\s+(things|it|everything|the\s+system)|system\s+(health|status)|what(’s|'s)?(\s+\w+){0,2}\s+happen(ed|ing)|show\s+me\s+(the\s+)?(status|activity|metrics))\b/i },
  { intent: 'monitor', pattern: /\b(monitor|status\s+of|is\s+everything\s+(ok|okay|working|fine))\b/i },

  // Find.
  { intent: 'find', pattern: /\b(find|search|look\s+for|locate|where\s+(is|are)|dig\s+up)\b/i },
  { intent: 'find', pattern: /\bshow\s+me\s+(everything|all|the\s+\w+)\s+(about|related|from|for)\b/i },

  // Communicate.
  { intent: 'communicate', pattern: /\b(invite|add)\s+\S+@\S+/i },
  { intent: 'communicate', pattern: /\binvite\s+(\w+\s+)?(to\s+(my|the|this)\s+workspace|as\s+a)/i },

  // Control — running a configured tool. The descriptor group matters:
  // people name the thing ("run the DEPLOYMENT tool"), and a grammar that
  // only accepts the bare noun silently fails to recognize the most natural
  // way to phrase it.
  //
  // WIDENED from one descriptor word to several, and found by binding the
  // capability: real tools are called "Alpha Deploy" and "Nightly Data
  // Sync", so "run the Alpha Deploy tool" — an entirely ordinary sentence —
  // was not recognized as a command at all and answered `not-implemented`.
  // Bounded rather than open-ended, and still anchored on the literal noun,
  // so the rule cannot drift into claiming unrelated sentences.
  { intent: 'control', pattern: /\b(run|execute|trigger|fire)\s+(the\s+|my\s+)?([\w-]+\s+){0,4}(tool|webhook|integration)\b/i },

  // Create.
  { intent: 'create', pattern: /\b(create|make|draft|write|generate|design|compose)\b/i },
  { intent: 'create', pattern: /\bstart\s+a\s+(new\s+)?(conversation|chat|project|document)\b/i },

  // Ask — last, because its patterns are the broadest.
  { intent: 'ask', pattern: /\b(what|who|why|when|which)\s+(is|are|was|were|does|do|did)\b/i },
  { intent: 'ask', pattern: /\b(explain|summari[sz]e|tell\s+me\s+about|help\s+me\s+understand)\b/i },
  { intent: 'ask', pattern: /\bhow\s+(do|does|can|should)\s+i\b/i },
];

/** Words carrying no subject meaning once the command verb is removed. */
const FILLER = new Set([
  'the', 'a', 'an', 'my', 'our', 'this', 'that', 'these', 'those', 'me',
  'please', 'for', 'to', 'of', 'about', 'related', 'all', 'everything',
  'from', 'in', 'on', 'up', 'and', 'synora', 'can', 'you', 'i', 'it',
]);

function observeText(raw: string, normalized: string): CommandTextObservation[] {
  const observations: CommandTextObservation[] = [];

  if (raw.length > MAX_COMMAND_LENGTH) {
    observations.push({
      kind: 'oversized-input',
      detail: `The text was longer than ${MAX_COMMAND_LENGTH} characters and was not treated as a command.`,
    });
  }

  // `.some` with non-global regexes: no `lastIndex` state to carry between
  // calls, so repeated evaluation is stable.
  if (AUTHORITY_OVERRIDE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    observations.push({
      kind: 'authority-override-attempt',
      // The payload is deliberately NOT echoed back: repeating attacker-
      // controlled text into logs and UIs is its own delivery mechanism.
      detail:
        'The text contained phrasing that tries to grant itself authority or bypass approval. ' +
        'It was read as data, not as an instruction, and changed nothing about what Synora would do.',
    });
  }

  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    observations.push({
      kind: 'destructive-phrasing',
      detail:
        'The text describes removing or shutting down something broadly. ' +
        'Synora has not acted on it; anything that would change a system outside Synora needs a person to confirm it first.',
    });
  }

  return observations;
}

function extractSubject(normalized: string, matched: RegExp | null): string {
  const withoutVerb = matched ? normalized.replace(matched, ' ') : normalized;
  return withoutVerb
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !FILLER.has(word.toLowerCase()))
    .join(' ')
    .trim();
}

/**
 * Interpret one human sentence. Never executes, never contacts a provider,
 * never throws on hostile input — a command layer that can be crashed by a
 * sentence is a denial-of-service surface.
 */
export function understandCommand(rawInput: string): CommandUnderstanding {
  const raw = typeof rawInput === 'string' ? rawInput : '';
  // Truncate BEFORE matching so a megabyte of text cannot drive regex work.
  const normalized = raw.slice(0, MAX_COMMAND_LENGTH).trim().replace(/\s+/g, ' ');
  const observations = observeText(raw, normalized);

  if (normalized.length === 0) {
    return {
      intent: 'unrecognized',
      subject: '',
      confidence: 'none',
      routes: [],
      unknowns: ['No command was given.'],
      observations,
      executed: false,
    };
  }

  const blocked = NOT_YET_CAPABLE_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  if (blocked) {
    return {
      intent: 'not-yet-capable',
      subject: extractSubject(normalized, null),
      confidence: 'high',
      routes: [],
      // Naming the missing capability is the useful part. "I don't
      // understand" would be false — Synora understood perfectly and simply
      // cannot do it, which is what the person needs to hear.
      unknowns: [`Synora cannot do this yet: ${blocked.what}.`],
      observations,
      executed: false,
    };
  }

  const rule = INTENT_RULES.find(({ pattern }) => pattern.test(normalized));
  if (!rule) {
    return {
      intent: 'unrecognized',
      subject: '',
      confidence: 'none',
      routes: [],
      unknowns: [
        'Synora could not tell what action was being asked for.',
        'Rephrasing with a plain verb — find, create, automate, plan, or show — usually resolves it.',
      ],
      observations,
      executed: false,
    };
  }

  const subject = extractSubject(normalized, rule.pattern);
  // Within one intent, a capability whose hint matches this sentence goes
  // first. Stable otherwise, so the catalogue's best-first order still
  // decides when nothing claims the sentence — a hint can promote a
  // capability, never hide one.
  const routes = [...routesForIntent(rule.intent)].sort((a, b) => {
    const aClaims = a.hint?.test(normalized) ? 1 : 0;
    const bClaims = b.hint?.test(normalized) ? 1 : 0;
    return bClaims - aClaims;
  });
  const unknowns: string[] = [];

  if (subject.length === 0) {
    unknowns.push('The action was recognized, but not what it should apply to.');
  }
  // Anything that cannot run here, NOT just the credential case. This
  // filter previously matched the literal 'needs-credentials', so widening
  // the vocabulary would have silently dropped `ai.generate` from the list
  // and told the person nothing was wrong with it.
  const unavailable = routes.filter((route) => !isRunnableHere(route));
  for (const route of unavailable) {
    unknowns.push(
      `"${route.summary}" is implemented but ${unavailableReason(route.availability)}, so it cannot run here yet.`
    );
  }

  return {
    intent: rule.intent,
    subject,
    confidence: subject.length > 0 ? 'high' : 'low',
    routes,
    unknowns,
    observations,
    executed: false,
  };
}
