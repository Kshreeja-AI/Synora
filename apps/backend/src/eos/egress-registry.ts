import { declareEgressPath } from './privacy-coverage.js';
import { sanitizePII } from '../workers/export-dataset.worker.js';
import { buildCapturedCase } from './case-capture.js';
import { buildRequestLogEntry } from '../middleware/requestLogger.js';

/**
 * Declares the paths that emit data outside Synora, so the privacy audit
 * can probe them with real sensitive values.
 *
 * Kept separate from the paths themselves because several of them import
 * the database client, and the audit must remain runnable without one.
 * Called once at startup.
 *
 * HONESTLY INCOMPLETE. Each path became probeable by extracting its
 * emission shape into a pure function, and each extraction has earned its
 * keep by finding a real leak: case capture stored `note` and caller tags
 * verbatim, and the request logger wrote `req.url` — query string
 * included — straight to the log.
 *
 * Still undeclared: file downloads, share links, and notification emails,
 * which sit behind the database client and need the same treatment.
 * Until they get it this registry is short, which is why the audit
 * reports the declared count alongside the percentage rather than a bare
 * score.
 *
 * ONE KNOWN, DELIBERATE EXCLUSION. The request-log path writes the client
 * IP as received. An IP is personal data, so this is a gap in the strict
 * sense — but it is a retained policy choice, not a redaction failure:
 * the address is what makes abuse investigation and incident response
 * work. The probe below covers the caller-controlled fields that
 * redaction is responsible for; it does not assert that nothing personal
 * is ever logged, because that would be false. Recorded here rather than
 * omitted, so the audit's own limitation is visible where the audit is.
 */
export function registerEgressPaths(): void {
  declareEgressPath({
    id: 'dataset-export',
    description: 'Evaluation dataset exported to a file for download.',
    probe: (input) => sanitizePII(input),
  });

  declareEgressPath({
    id: 'case-capture',
    description: 'Customer interaction captured into an evaluation dataset engineers will read.',
    probe: (input) => {
      // The real transformation on a synthetic interaction, with every
      // caller-controlled field carrying the probe text. Note and tags are
      // included deliberately: those are the fields that leaked before this
      // probe existed, precisely because they felt like metadata.
      const built = buildCapturedCase(
        {
          promptId: 'privacy-probe',
          input,
          output: input,
          success: false,
          note: input,
          tags: [input],
        },
        'probe',
      );
      return [built.input, built.actualOutput, built.note ?? '', ...built.tags].join('\n');
    },
  });

  declareEgressPath({
    id: 'request-log',
    description: 'HTTP request line written to the application log, read and shipped by engineers.',
    probe: (input) => {
      // Percent-encoded, because that is how Express hands over req.url —
      // a probe that passed the readable form would test a string the
      // logger never actually receives, and would have missed that
      // encoding defeated redaction entirely.
      const entry = buildRequestLogEntry({
        method: 'GET',
        url: `/api/search?q=${encodeURIComponent(input)}`,
        statusCode: 200,
        durationMs: 12,
        userAgent: input,
      });
      return [entry.message, String(entry.meta.userAgent)].join('\n');
    },
  });
}
