import { declareEgressPath } from './privacy-coverage.js';
import { sanitizePII } from '../workers/export-dataset.worker.js';

/**
 * Declares the paths that emit data outside Synora, so the privacy audit
 * can probe them with real sensitive values.
 *
 * Kept separate from the paths themselves because several of them import
 * the database client, and the audit must remain runnable without one.
 * Called once at startup.
 *
 * HONESTLY INCOMPLETE. Only paths that can be probed without global side
 * effects are declared today. Case capture redacts on the way in, but
 * probing it end to end would require starting capture into a scratch
 * dataset mid-audit, which mutates state the audit is meant to observe.
 * Making it probeable is real work, and until it is done this registry is
 * short — which is why the audit reports the declared count alongside the
 * percentage rather than a bare score.
 */
export function registerEgressPaths(): void {
  declareEgressPath({
    id: 'dataset-export',
    description: 'Evaluation dataset exported to a file for download.',
    probe: (input) => sanitizePII(input),
  });
}
