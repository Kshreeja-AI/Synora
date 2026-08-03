import { describe, it, expect } from 'vitest';
import { redact, containsSensitive, defaultRedactionRules } from '../redaction';

describe('redaction', () => {
  it('redacts email addresses', () => {
    const result = redact('Contact me at keshav@synora.ai please');
    expect(result.text).toBe('Contact me at [REDACTED_EMAIL] please');
    expect(result.counts.email).toBe(1);
    expect(result.redacted).toBe(true);
  });

  it('redacts provider-style API keys', () => {
    const result = redact('key is sk-abcdefghijklmnop1234567890 ok');
    expect(result.text).toContain('[REDACTED_API_KEY]');
    expect(result.text).not.toContain('abcdefghijklmnop');
  });

  it('redacts GitHub and Slack token shapes', () => {
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz01').text).toContain('[REDACTED_API_KEY]');
    expect(redact('xoxb-1234567890-abcdefg').text).toContain('[REDACTED_API_KEY]');
  });

  it('redacts bearer tokens', () => {
    const result = redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(result.text).toContain('[REDACTED_TOKEN]');
    expect(result.text).not.toContain('abcdefghijklmnop');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redact(`token ${jwt}`);
    expect(result.text).toContain('[REDACTED_JWT]');
    expect(result.text).not.toContain('eyJzdWIi');
  });

  it('redacts credit card numbers with and without separators', () => {
    expect(redact('card 4111111111111111').text).toContain('[REDACTED_CARD]');
    expect(redact('card 4111 1111 1111 1111').text).toContain('[REDACTED_CARD]');
    expect(redact('card 4111-1111-1111-1111').text).toContain('[REDACTED_CARD]');
  });

  it('redacts SSNs and IP addresses', () => {
    expect(redact('ssn 123-45-6789').text).toContain('[REDACTED_SSN]');
    expect(redact('from 192.168.1.100').text).toContain('[REDACTED_IP]');
  });

  it('redacts international phone numbers across grouping conventions', () => {
    // An earlier pattern assumed 3-4 digit groups and missed the 5-5
    // grouping used by Indian mobile numbers.
    for (const number of ['+91 98765 43210', '+1 415-555-0123', '+44 20 7946 0958', '+1 (415) 555-0123']) {
      const result = redact(`call ${number} now`);
      expect(result.text, `failed to redact ${number}`).toContain('[REDACTED_PHONE]');
      expect(result.text).not.toContain('555');
    }
  });

  it('leaves clean text untouched', () => {
    const clean = 'Summarise the quarterly report in three bullet points.';
    const result = redact(clean);
    expect(result.text).toBe(clean);
    expect(result.redacted).toBe(false);
    expect(result.counts).toEqual({});
  });

  it('redacts several distinct kinds in one pass', () => {
    const result = redact('mail a@b.com from 10.0.0.1 with ssn 111-22-3333');
    expect(result.text).toContain('[REDACTED_EMAIL]');
    expect(result.text).toContain('[REDACTED_IP]');
    expect(result.text).toContain('[REDACTED_SSN]');
    expect(Object.keys(result.counts).sort()).toEqual(['email', 'ipv4', 'ssn']);
  });

  it('counts multiple occurrences of the same kind', () => {
    const result = redact('a@x.com and b@y.com and c@z.com');
    expect(result.counts.email).toBe(3);
    expect(result.text).not.toContain('@x.com');
  });

  it('is not order-dependent across repeated calls', () => {
    // A shared /g/ regex would carry lastIndex between calls and silently
    // miss matches on the second invocation.
    const input = 'a@x.com';
    expect(redact(input).counts.email).toBe(1);
    expect(redact(input).counts.email).toBe(1);
    expect(redact(input).counts.email).toBe(1);
  });

  it('containsSensitive detects and clears correctly', () => {
    expect(containsSensitive('reach me at a@b.com')).toBe(true);
    expect(containsSensitive('nothing sensitive here')).toBe(false);
    // Redacted output must no longer trip the detector.
    expect(containsSensitive(redact('reach me at a@b.com').text)).toBe(false);
  });

  it('accepts custom rules', () => {
    const result = redact('internal code ZX-9', [
      { name: 'code', pattern: /ZX-\d/g, placeholder: '[CODE]' },
    ]);
    expect(result.text).toBe('internal code [CODE]');
  });

  it('every default rule is global so all occurrences are replaced', () => {
    for (const rule of defaultRedactionRules) {
      expect(rule.pattern.flags).toContain('g');
    }
  });

  // Regression guard for the customer-facing dataset export path, which
  // previously carried its own weaker patterns in export-dataset.worker.ts
  // and leaked every one of these. It now delegates here; these cases keep
  // that consolidation honest.
  it.each([
    ['Indian mobile', 'call me on +91 98765 43210', '98765'],
    ['Amex card, 15 digits', 'card 3782 822463 10005', '822463'],
    ['OpenAI-style API key', 'key sk-abcdefghijklmnop1234567890', 'abcdefghijklmnop'],
    ['GitHub token', 'token ghp_abcdefghijklmnopqrstuvwxyz01', 'abcdefghijklmnop'],
    ['Bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', 'abcdefghijklmnop'],
    ['IP address', 'from 192.168.1.100', '192.168.1.100'],
  ])('export path no longer leaks: %s', (_label, input, mustNotRemain) => {
    const result = redact(input);
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain(mustNotRemain);
  });

  it('handles long adversarial input without hanging', () => {
    const nasty = `${'1'.repeat(5000)} ${'a'.repeat(5000)}@`;
    const began = Date.now();
    redact(nasty);
    expect(Date.now() - began).toBeLessThan(2000);
  });
});
