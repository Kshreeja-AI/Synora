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

  it('redacts Indian PAN and Aadhaar', () => {
    expect(redact('PAN ABCDE1234F').text).toContain('[REDACTED_PAN]');

    for (const aadhaar of ['1234 5678 9012', '1234-5678-9012', '123456789012']) {
      const result = redact(`aadhaar ${aadhaar}`);
      expect(result.text, `failed on ${aadhaar}`).toContain('[REDACTED_AADHAAR]');
      expect(result.text).not.toContain('5678');
    }
  });

  it('redacts Indian passport, IBAN, and UK NIN', () => {
    expect(redact('passport K1234567').text).toContain('[REDACTED_PASSPORT]');
    expect(redact('iban GB33BUKB20201555555555').text).toContain('[REDACTED_IBAN]');
    expect(redact('nin AB123456C').text).toContain('[REDACTED_NIN]');
    // Q is not a permitted NIN prefix letter, so this correctly does not match.
    expect(redact('nin QQ123456C').text).not.toContain('[REDACTED_NIN]');
  });

  it('does not let Aadhaar swallow longer card numbers', () => {
    // The card rule requires 13+ digits and runs first, so a 16-digit card
    // must still be labelled as a card rather than an Aadhaar.
    const result = redact('card 4111111111111111');
    expect(result.text).toContain('[REDACTED_CARD]');
    expect(result.text).not.toContain('[REDACTED_AADHAAR]');
  });

  it('documented limits: prose PII is not caught', () => {
    // Asserting the limitation rather than leaving it implied, so nobody
    // mistakes this module for complete protection.
    const prose = 'I live at 42 Green Lane, third floor, and work for Acme';
    expect(redact(prose).redacted).toBe(false);
  });

  it('handles long adversarial input without hanging', () => {
    const nasty = `${'1'.repeat(5000)} ${'a'.repeat(5000)}@`;
    const began = Date.now();
    redact(nasty);
    expect(Date.now() - began).toBeLessThan(2000);
  });
  describe('percent-encoded values', () => {
    // The class of bug found in the request logger. Every rule matches
    // readable text, and a URL does not arrive readable — so redaction
    // that only sees the encoded form does nothing while appearing to
    // work. Fixed in the redactor so every caller inherits the fix.

    it('redacts an email that arrived percent-encoded', () => {
      const encoded = `/api/search?q=${encodeURIComponent('keshav@synora.ai')}`;
      expect(encoded).toContain('%40');

      const result = redact(encoded);

      expect(result.text).toContain('[REDACTED_EMAIL]');
      expect(result.text).not.toContain('%40');
      expect(result.counts.email).toBe(1);
    });

    it('catches encoded values in chat text, not only in URLs', () => {
      // Case capture and dataset export run the same redactor over user
      // text. A pasted link carries the same leak into an evaluation
      // dataset an engineer will read.
      const pasted = 'see https://x.example/u?mail=someone%40example.com for context';

      const result = redact(pasted);

      expect(result.text).toContain('[REDACTED_EMAIL]');
      expect(result.text).not.toContain('someone%40example.com');
    });

    it('preserves surrounding structure rather than blanking the run', () => {
      // Over-redaction is the intended trade, but a readable result is
      // still more useful than an opaque blob.
      const result = redact('/api/x?q=a%40b.com&limit=50');

      expect(result.text).toContain('[REDACTED_EMAIL]');
      expect(result.text).toContain('limit=50');
    });

    it('leaves ordinary text with escapes untouched', () => {
      const harmless = '/api/search?q=hello%20world&sort=name';
      expect(redact(harmless).redacted).toBe(false);
      expect(redact(harmless).text).toBe(harmless);
    });

    it('never throws on a malformed escape, and still redacts the rest', () => {
      // Any caller can supply a lone '%'. Degraded coverage is acceptable;
      // an exception thrown from a redaction path is not.
      expect(() => redact('/api/x?q=100%')).not.toThrow();
      expect(redact('/api/x?q=100%').text).toBe('/api/x?q=100%');

      const mixed = redact('/api/x?bad=%&mail=k%40s.ai');
      expect(mixed.text).toContain('[REDACTED_EMAIL]');
    });

    it('a stray % cannot be used to smuggle an encoded value past redaction', () => {
      // Found by the test above. decodeURIComponent rejects a whole string
      // on one bad escape, so decoding per-run meant an attacker could
      // prepend a lone '%' and protect everything after it. Decoding falls
      // back to per-escape precisely so that evasion does not work.
      const evasions = [
        '%&mail=victim%40example.com',
        'x=%zz&card=4111%2D1111%2D1111%2D1111',
        '%%%mail=a%40b.com',
      ];

      for (const attempt of evasions) {
        expect(redact(attempt).redacted).toBe(true);
      }
    });

    it('counts an encoded hit once, not twice', () => {
      const result = redact(`mail=${encodeURIComponent('a@b.com')}`);
      expect(result.counts.email).toBe(1);
    });

    it('containsSensitive agrees with redact on encoded input', () => {
      const encoded = `?mail=${encodeURIComponent('a@b.com')}`;
      // These must never disagree: a caller checking containsSensitive
      // before storing would otherwise be told the text was clean.
      expect(containsSensitive(encoded)).toBe(true);
      expect(redact(encoded).redacted).toBe(true);
    });

    it('handles a long encoded run without hanging', () => {
      const nasty = `?q=${'%41'.repeat(4000)}`;
      const began = Date.now();
      redact(nasty);
      expect(Date.now() - began).toBeLessThan(2000);
    });
  });
});
