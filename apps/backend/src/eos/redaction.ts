/**
 * Redaction for text captured from real user interactions.
 *
 * Captured evaluation cases are derived from genuine customer traffic, so
 * they must be scrubbed before they are stored anywhere an engineer will
 * later read them. This errs deliberately toward over-redaction: a case
 * with an over-scrubbed value is still useful for evaluation, whereas a
 * leaked secret is not recoverable once written down.
 *
 * Every pattern is linear-time and anchored to bounded character classes
 * to avoid catastrophic backtracking on adversarial input.
 *
 * KNOWN LIMITS — read before relying on this as the only control.
 *
 * This recognises identifiers that have a *shape*. It cannot recognise
 * sensitive information expressed as ordinary prose, and no amount of
 * pattern-tuning will change that. It will not catch:
 *
 *   - postal addresses written naturally ("42 Green Lane, third floor")
 *   - names, employers, job titles, or relationships
 *   - dates of birth (deliberately omitted: a pattern broad enough to
 *     catch them redacts every date, which destroys the usefulness of
 *     captured text for almost no privacy gain)
 *   - health, financial, or legal details described in words
 *   - identifiers from schemes not listed above
 *
 * Treat it as one layer. Consent, access control, and retention limits
 * are the other layers, and this does not replace them.
 */

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  placeholder: string;
}

export const defaultRedactionRules: RedactionRule[] = [
  {
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    placeholder: '[REDACTED_EMAIL]',
  },
  {
    // Common provider key shapes (sk-..., ghp_..., xoxb-...) before the
    // generic token rule, so the more specific label wins.
    name: 'apiKey',
    pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{16,}|\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    placeholder: '[REDACTED_API_KEY]',
  },
  {
    name: 'bearerToken',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
    placeholder: '[REDACTED_TOKEN]',
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    placeholder: '[REDACTED_JWT]',
  },
  {
    // 13-19 digits, optionally separated by single spaces or hyphens.
    name: 'creditCard',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    placeholder: '[REDACTED_CARD]',
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: '[REDACTED_SSN]',
  },
  {
    // Indian PAN: five letters, four digits, one letter. Highly specific,
    // so false positives are essentially impossible.
    name: 'panIndia',
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    placeholder: '[REDACTED_PAN]',
  },
  {
    // Indian Aadhaar: 12 digits, conventionally grouped 4-4-4. Runs after
    // the card rule, which requires 13+ digits, so the two cannot collide.
    // A bare 12-digit number that is not an Aadhaar will also be redacted;
    // that over-redaction is the intended trade.
    name: 'aadhaarIndia',
    pattern: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,
    placeholder: '[REDACTED_AADHAAR]',
  },
  {
    // Indian passport: one letter followed by seven digits.
    name: 'passportIndia',
    pattern: /\b[A-PR-WY]\d{7}\b/g,
    placeholder: '[REDACTED_PASSPORT]',
  },
  {
    name: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    placeholder: '[REDACTED_IBAN]',
  },
  {
    // UK National Insurance number.
    name: 'ninUk',
    pattern: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,
    placeholder: '[REDACTED_NIN]',
  },
  {
    name: 'ipv4',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    placeholder: '[REDACTED_IP]',
  },
  {
    // International numbers, matched as "+ then a run of digits and
    // separators". An earlier version encoded 3-4 digit groupings and so
    // missed formats that group differently — Indian mobiles split 5-5,
    // for example. Matching the general shape rather than any national
    // convention avoids that whole class of gap. Runs after card and SSN
    // so those keep their more specific labels.
    name: 'phone',
    pattern: /\+\d[\d ()-]{6,18}\d/g,
    placeholder: '[REDACTED_PHONE]',
  },
];

export interface RedactionResult {
  text: string;
  /** Rule name → number of substitutions, for auditing what was found. */
  counts: Record<string, number>;
  redacted: boolean;
}

/**
 * A run of URL-ish characters containing at least one percent-escape.
 * Bounded character class, linear time — same discipline as the rules.
 */
const PERCENT_ENCODED_RUN =
  /[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*%[0-9A-Fa-f]{2}[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*/g;

function applyRules(
  input: string,
  rules: RedactionRule[],
  counts: Record<string, number>,
): string {
  let text = input;
  for (const rule of rules) {
    // Fresh RegExp per call: a shared /g/ regex carries lastIndex between
    // calls, which would silently skip matches on later invocations.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let hits = 0;
    text = text.replace(re, () => {
      hits += 1;
      return rule.placeholder;
    });
    if (hits > 0) counts[rule.name] = (counts[rule.name] ?? 0) + hits;
  }
  return text;
}

/**
 * Second pass over percent-encoded runs.
 *
 * WHY THIS EXISTS. Every rule matches readable text, and sensitive values
 * do not always arrive readable. `someone@example.com` in a URL arrives as
 * `someone%40example.com`; the email rule needs a literal `@`, never
 * fires, and the value passes through untouched — into a log, an
 * evaluation case, or an export — where anything that decodes will render
 * it in full. Redaction applied only to the encoded form is redaction that
 * looks like it works. This was found in the request logger and is fixed
 * here rather than there, because the flaw belongs to the redactor and
 * every caller inherits it.
 *
 * Only runs containing an escape are touched, and only when decoding
 * actually reveals something, so ordinary text is returned unchanged.
 */
/**
 * Decodes percent-escapes without ever throwing, and without letting one
 * bad escape protect the rest of the string.
 *
 * WHY NOT JUST `decodeURIComponent`. It rejects the whole input on a
 * single malformed sequence — a lone `%`. Applied to a run, that means
 * `?bad=%&mail=k%40s.ai` fails wholesale and the perfectly valid `%40`
 * survives unredacted. Since anyone can add a stray `%`, that turns a
 * decoding quirk into a deliberate way to smuggle a value past redaction.
 *
 * So: try the whole run first, because that handles multi-byte UTF-8
 * correctly; if it fails, decode escape by escape and leave the ones that
 * cannot stand alone. Multi-byte sequences then stay encoded, which is
 * harmless — every rule here matches ASCII.
 */
function decodePercentEscapes(run: string): string {
  try {
    return decodeURIComponent(run);
  } catch {
    return run.replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
      try {
        return decodeURIComponent(escape);
      } catch {
        return escape;
      }
    });
  }
}

function redactEncodedRuns(
  input: string,
  rules: RedactionRule[],
  counts: Record<string, number>,
): string {
  const re = new RegExp(PERCENT_ENCODED_RUN.source, PERCENT_ENCODED_RUN.flags);

  return input.replace(re, (run) => {
    const decoded = decodePercentEscapes(run);
    if (decoded === run) return run;

    const found: Record<string, number> = {};
    const cleaned = applyRules(decoded, rules, found);
    if (Object.keys(found).length === 0) return run;

    for (const [name, n] of Object.entries(found)) {
      counts[name] = (counts[name] ?? 0) + n;
    }
    // The decoded, redacted form replaces the run. Structure survives —
    // `?q=x%40y.com` becomes `?q=[REDACTED_EMAIL]`, not an opaque blob.
    return cleaned;
  });
}

export function redact(input: string, rules: RedactionRule[] = defaultRedactionRules): RedactionResult {
  const counts: Record<string, number> = {};

  // Readable form first, so direct matches are found on the text as
  // supplied; then the encoded form, which catches what encoding hid.
  let text = applyRules(input, rules, counts);
  text = redactEncodedRuns(text, rules, counts);

  return { text, counts, redacted: Object.keys(counts).length > 0 };
}

/**
 * True when the text still appears to contain anything the rules match.
 * Runs the same two passes as `redact`, so an encoded value is not
 * reported clean here while `redact` would remove it.
 */
export function containsSensitive(input: string, rules: RedactionRule[] = defaultRedactionRules): boolean {
  return redact(input, rules).redacted;
}
