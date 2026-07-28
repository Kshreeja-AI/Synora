import type { MailTransportDescriptor } from './types/descriptor';

// Re-export for backwards compatibility
export type { MailTransportDescriptor };

import { consoleTransportDescriptor } from './transports/console.transport';
import { smtpTransportDescriptor } from './transports/smtp.transport';

/**
 * Every transport this application knows how to talk to. Unlike the AI
 * provider registry, mail transport selection is never auto-detected —
 * `console` is always valid (it has no external dependency), so silently
 * "upgrading" to a real transport just because credentials happen to be
 * present would be surprising. Selection is always the explicit
 * `MAIL_TRANSPORT` config value (see `./resolver.ts`).
 */
export const TRANSPORT_REGISTRY: readonly MailTransportDescriptor[] = [
  consoleTransportDescriptor,
  smtpTransportDescriptor,
];

export function getTransportDescriptor(id: string): MailTransportDescriptor | undefined {
  return TRANSPORT_REGISTRY.find((t) => t.id === id);
}
