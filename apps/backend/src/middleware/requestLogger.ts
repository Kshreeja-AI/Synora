import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { redact } from '../eos/redaction';

interface RequestWithContext extends Request {
  correlationId?: string;
  requestId?: string;
  traceId?: string;
}

export interface RequestLogInput {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  correlationId?: string;
  requestId?: string;
  traceId?: string;
  userAgent?: string;
  ip?: string;
}

export interface RequestLogEntry {
  message: string;
  meta: Record<string, unknown>;
}

/**
 * Builds exactly what gets written to the log for one request.
 *
 * PURE, SO THE PRIVACY AUDIT CAN PROBE IT. Logs are an egress path — they
 * are shipped, retained, and read by engineers — and this one was writing
 * `req.url` verbatim. A URL carries its query string, and query strings
 * routinely carry the things that must never be written down:
 * `?search=someone@example.com`, `?token=...`, a shared link's secret.
 *
 * The URL is redacted whole rather than only its query portion. Path
 * segments are opaque identifiers that match no redaction rule, so
 * redacting the whole string costs nothing and removes the question of
 * whether a sensitive value can appear in a path — which it can, in any
 * route that takes a human-supplied value.
 *
 * The user agent is redacted for the same reason: it is client-supplied
 * text, and client-supplied text is where sensitive values live.
 *
 * IP IS DEPARTED FROM THAT RULE, DELIBERATELY AND VISIBLY. `ip` is written
 * as received. It is personal data, and this is a policy choice rather
 * than an oversight: the address is what makes abuse investigation, rate
 * limit forensics, and incident response possible, and pseudonymising it
 * would remove capabilities (geolocation, correlation with threat feeds,
 * blocking from logs) that security work depends on. That trade is the
 * founder's to make, not this module's, so the behaviour is unchanged and
 * recorded here rather than quietly altered. See the egress registry,
 * which states the same limitation where the audit can see it.
 */
/**
 * Percent-decodes before redaction, because redaction patterns match
 * readable text and a URL does not arrive readable.
 *
 * THIS IS THE WHOLE REASON THE FUNCTION EXISTS. Express hands over
 * `req.url` still encoded, so a browser sending `?q=someone@example.com`
 * produces `?q=someone%40example.com`. The email rule needs a literal `@`
 * and never fires — the value passes redaction untouched and lands in the
 * log fully readable to anyone who opens it, because log viewers decode.
 * Redacting the encoded form is redaction that looks like it works.
 *
 * Never throws. `decodeURIComponent` rejects malformed sequences such as a
 * lone `%`, which any client can send deliberately, and a logger that
 * throws takes down the response it was only supposed to describe. An
 * undecodable string is redacted as-is: worse coverage, never an outage.
 */
function decodeForRedaction(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildRequestLogEntry(input: RequestLogInput): RequestLogEntry {
  return {
    message: `${input.method} ${redact(decodeForRedaction(input.url)).text}`,
    meta: {
      correlationId: input.correlationId,
      requestId: input.requestId,
      traceId: input.traceId,
      statusCode: input.statusCode,
      duration: `${input.durationMs}ms`,
      userAgent:
        input.userAgent === undefined ? undefined : redact(decodeForRedaction(input.userAgent)).text,
      ip: input.ip,
    },
  };
}

export function requestLogger(req: RequestWithContext, res: Response, next: NextFunction) {
  const start = Date.now();
  const originalSend = res.send;

  res.send = function (data) {
    const entry = buildRequestLogEntry({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      correlationId: req.correlationId,
      requestId: req.requestId,
      traceId: req.traceId,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    logger.info(entry.message, entry.meta);

    return originalSend.call(this, data);
  };

  next();
}
