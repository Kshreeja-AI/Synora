/**
 * Request-log redaction tests.
 *
 * The log line is an egress path: it is written, shipped, retained, and
 * read by engineers. It was writing `req.url` verbatim, and a URL carries
 * its query string.
 *
 * The property that actually needs guarding is subtler than "redact the
 * URL", and these tests exist because the obvious fix was wrong: Express
 * hands over `req.url` still percent-encoded, so redacting it directly
 * matches nothing and produces a log line that looks sanitised and is not.
 */

import { describe, it, expect } from 'vitest';
import { buildRequestLogEntry } from '../requestLogger';

const line = (url: string, userAgent?: string) =>
  buildRequestLogEntry({
    method: 'GET',
    url,
    statusCode: 200,
    durationMs: 12,
    userAgent,
  });

describe('request log redaction', () => {
  it('redacts a sensitive value in a query string', () => {
    const entry = line('/api/search?q=keshav@synora.ai');

    expect(entry.message).toContain('[REDACTED_EMAIL]');
    expect(entry.message).not.toContain('keshav@synora.ai');
  });

  it('redacts percent-encoded values, which is how they actually arrive', () => {
    // The defect this whole module was rewritten for. Express does not
    // decode req.url, so the email rule — which needs a literal '@' —
    // never fired against '%40'. The value passed through untouched and
    // any log viewer rendered it back in full.
    const encoded = `/api/search?q=${encodeURIComponent('keshav@synora.ai')}`;
    expect(encoded).toContain('%40');

    const entry = line(encoded);

    expect(entry.message).toContain('[REDACTED_EMAIL]');
    expect(entry.message).not.toContain('%40');
    expect(entry.message).not.toContain('keshav');
  });

  it('redacts tokens and card numbers passed as query parameters', () => {
    const entry = line(
      `/api/x?token=${encodeURIComponent('sk-live-abcdefghijklmnopqrstuvwxyz')}&card=4111111111111111`,
    );

    expect(entry.message).toContain('[REDACTED_API_KEY]');
    expect(entry.message).toContain('[REDACTED_CARD]');
    expect(entry.message).not.toContain('sk-live');
    expect(entry.message).not.toContain('4111111111111111');
  });

  it('keeps the route readable, because a redacted log must still be useful', () => {
    const entry = line('/api/conversations/clx1a2b3c4d5/messages?limit=50');

    // Opaque identifiers match no rule, so operational value survives.
    expect(entry.message).toBe('GET /api/conversations/clx1a2b3c4d5/messages?limit=50');
  });

  it('redacts the user agent, which is client-supplied text', () => {
    const entry = line('/api/health', 'MyApp/1.0 (contact: ops@synora.ai)');

    expect(entry.meta.userAgent).toContain('[REDACTED_EMAIL]');
    expect(entry.meta.userAgent).not.toContain('ops@synora.ai');
  });

  it('never throws on a malformed percent sequence', () => {
    // Any client can send a lone '%'. decodeURIComponent rejects it, and a
    // logger that throws takes down the response it only meant to describe.
    expect(() => line('/api/search?q=100%')).not.toThrow();
    expect(() => line('/api/x?a=%E0%A4%A')).not.toThrow();

    const entry = line('/api/search?q=100%');
    expect(entry.message).toBe('GET /api/search?q=100%');
  });

  it('still redacts what it can when the URL is undecodable', () => {
    // Degraded coverage, never an outage: the readable part is handled.
    const entry = line('/api/x?bad=%&email=keshav@synora.ai');

    expect(entry.message).toContain('[REDACTED_EMAIL]');
    expect(entry.message).not.toContain('keshav@synora.ai');
  });

  it('preserves the operational fields the log exists for', () => {
    const entry = buildRequestLogEntry({
      method: 'POST',
      url: '/api/messages',
      statusCode: 201,
      durationMs: 42,
      correlationId: 'corr-1',
      requestId: 'req-1',
      traceId: 'trace-1',
    });

    expect(entry.meta.statusCode).toBe(201);
    expect(entry.meta.duration).toBe('42ms');
    expect(entry.meta.correlationId).toBe('corr-1');
    expect(entry.meta.requestId).toBe('req-1');
    expect(entry.meta.traceId).toBe('trace-1');
  });

  it('writes the IP as received — a recorded policy choice, not an oversight', () => {
    const entry = buildRequestLogEntry({
      method: 'GET',
      url: '/api/health',
      statusCode: 200,
      durationMs: 1,
      ip: '203.0.113.42',
    });

    // An IP is personal data, so this is a real gap in the strict sense.
    // It is retained because abuse investigation and incident response
    // depend on the address, and that trade belongs to the founder rather
    // than to this module. Asserted so the behaviour cannot drift
    // silently in either direction.
    expect(entry.meta.ip).toBe('203.0.113.42');
  });
});
