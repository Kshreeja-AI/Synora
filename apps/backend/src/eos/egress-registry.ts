import { declareEgressPath } from './privacy-coverage.js';
import { sanitizePII } from '../workers/export-dataset.worker.js';
import { buildCapturedCase } from './case-capture.js';

/**
 * Declares the paths that emit data outside Synora, so the privacy audit
 * can probe them with real sensitive values.
 *
 * Kept separate from the paths themselves because several of them import
 * the database client, and the audit must remain runnable without one.
 * Called once at startup.
 *
 * HONESTLY INCOMPLETE. Case capture became probeable by extracting its
 * stored-form transformation into a pure function — and probing it
 * immediately earned its keep: the note and caller-tag fields were being
 * stored verbatim, exactly the class of leak the export path had before
 * it. Still undeclared: file downloads, share links, notification emails,
 * and request logs, which live behind the database client and need the
 * same treatment. Until they get it this registry is short — which is why
 * the audit reports the declared count alongside the percentage rather
 * than a bare score.
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
}
