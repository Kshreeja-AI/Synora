import { getConfig } from '../config';
import { TRANSPORT_REGISTRY, getTransportDescriptor } from './registry';
import { MailTransportError, type MailTransport } from './types';

/**
 * Selects and constructs the active mail transport.
 *
 * Unlike AI provider selection, this is never auto-detected across the
 * registry — `mail.transport` (env: `MAIL_TRANSPORT`) is the single
 * explicit switch, defaulting to `console`. Auto-detecting "SMTP creds
 * happen to be present" would be surprising given SecretsManager's
 * placeholder fallback in development/testing/qa (see
 * `secrets/sources/placeholderSource.ts`) — every secret key "resolves" to
 * something in those stages, so presence alone can't mean "really
 * configured". An explicit, unmistakable operator choice is required.
 */
export async function resolveMailTransport(): Promise<MailTransport> {
  const transportId = getConfig().mail.transport;
  const descriptor = getTransportDescriptor(transportId);

  if (!descriptor) {
    throw new Error(
      `MAIL_TRANSPORT is set to a value that is not a known transport. ` +
        // Value withheld: a mistyped selection variable has been observed to
        // contain an API key, and this error is logged.

        `Known transports: ${TRANSPORT_REGISTRY.map((t) => t.id).join(', ')}.`
    );
  }

  if (!(await descriptor.isConfigured())) {
    throw new MailTransportError(
      `Mail transport "${transportId}" is not configured — its required settings/secrets are missing.`,
      transportId
    );
  }

  return descriptor.create();
}
