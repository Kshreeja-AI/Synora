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

export function redact(input: string, rules: RedactionRule[] = defaultRedactionRules): RedactionResult {
  let text = input;
  const counts: Record<string, number> = {};

  for (const rule of rules) {
    // Fresh RegExp per call: a shared /g/ regex carries lastIndex between
    // calls, which would silently skip matches on later invocations.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let hits = 0;
    text = text.replace(re, () => {
      hits += 1;
      return rule.placeholder;
    });
    if (hits > 0) counts[rule.name] = hits;
  }

  return { text, counts, redacted: Object.keys(counts).length > 0 };
}

/** True when the text still appears to contain anything the rules match. */
export function containsSensitive(input: string, rules: RedactionRule[] = defaultRedactionRules): boolean {
  return rules.some((rule) => new RegExp(rule.pattern.source, rule.pattern.flags).test(input));
}
