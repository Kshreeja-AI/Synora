import type { MailTransport } from '../types';

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
