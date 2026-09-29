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
 * THE REMAINING PATHS ARE DELIBERATELY ABSENT, NOT PENDING. Earlier notes
 * here listed file downloads, share links, and notification emails as gaps
 * still to close. Auditing them showed that framing was wrong, and the
 * distinction is worth stating because it decides what this registry is
 * for:
 *
 *   DERIVED paths carry data to an audience the person never chose —
 *   engineers reading logs, evaluation datasets, exports. The person had
 *   no say, so redaction is the control, and those are the three declared
 *   below.
 *
 *   DIRECTED paths carry data to an audience the person picked. A share
 *   link publishes the conversation its owner chose to publish. An
 *   invitation email tells the invitee who invited them and to what. A
 *   download returns the file its owner uploaded. Redacting any of these
 *   does not protect anyone — it breaks the feature while leaving the
 *   privacy question untouched. Their real controls are authorization,
 *   token scoping, expiry, and revocation, all of which exist.
 *
 * So the denominator is not "3 of many". It is close to complete for the
 * paths where redaction is the right instrument. The risk that remains on
 * a directed path is different in kind: leaking AMBIENT data the person
 * did not choose to include — an owner's email riding along with a shared
 * conversation, say. That is a payload-shape property, pinned by tests
 * next to each path, not something a redaction probe can measure.
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
