/**
 * Provider-agnostic mail contracts, mirroring `src/ai/types.ts`.
 *
 * The rest of the application (routes, services) depends only on the
 * functions exported from `./index.ts` — never on a concrete transport.
 * Adding, removing, or swapping a transport is entirely contained within
 * `./transports/*`; nothing outside this directory should ever import
 * `nodemailer` (or any other mail SDK) directly.
 */

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

/** Implemented by any transport that can actually deliver a message. */
export interface MailTransport {
  readonly id: string;
  send(message: MailMessage): Promise<void>;
}

/**
 * Thrown when a transport fails to deliver for a reason the caller can act
 * on (missing configuration, upstream error) — never a raw SDK/HTTP error,
 * so route code never needs to know which transport failed or how its SDK
 * shapes its errors.
 */
export class MailTransportError extends Error {
  constructor(
    message: string,
    readonly transportId: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'MailTransportError';
  }
}

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}
