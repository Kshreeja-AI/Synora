import type { Guardrail, GuardrailVerdict } from '@synora/core';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,16}\b/;

/**
 * Heuristic PII detector. Blocks on the highest-confidence patterns
 * (SSN, credit card) and flags the rest; tune per product by
 * subclassing or wrapping with product-specific allowlists (e.g. a
 * support product may need to accept emails).
 */
export class PiiGuardrail implements Guardrail {
  readonly name = 'pii';

  async check(input: { text: string }): Promise<GuardrailVerdict> {
    if (SSN_RE.test(input.text)) {
      return { allowed: false, reason: 'Detected a US SSN-shaped value', category: 'pii.ssn' };
    }
    if (CREDIT_CARD_RE.test(input.text.replace(/\s/g, ''))) {
      return {
        allowed: false,
        reason: 'Detected a credit-card-shaped value',
        category: 'pii.credit_card',
      };
    }
    if (EMAIL_RE.test(input.text) || PHONE_RE.test(input.text)) {
      return {
        allowed: false,
        reason: 'Detected an email address or phone number',
        category: 'pii.contact',
      };
    }
    return { allowed: true };
  }
}
