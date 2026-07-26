import type { MailTransport } from './types';

/**
 * What a transport module publishes about itself. The registry and
 * resolver only ever interact with this shape — never with a transport's
 * underlying SDK or wire protocol. That detail is entirely inside each
 * transport's own file under `./transports/`.
 */
export interface MailTransportDescriptor {
  readonly id: string;
  readonly displayName: string;
  /**
   * Cheap, no-network-call check: are this transport's required secrets/
   * config present? Used to give a clear error when a transport is
   * explicitly selected but not configured.
   */
  isConfigured(): Promise<boolean>;
  /** Construct a working transport instance. Only called after isConfigured() has returned true. */
  create(): Promise<MailTransport>;
}

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
