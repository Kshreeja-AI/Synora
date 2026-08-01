import { logger } from '../../utils/logger';
import type { MailMessage, MailTransport } from '../types';
import type { MailTransportDescriptor } from '../types/descriptor';

/**
 * Default transport for every stage until a real provider is configured.
 * Logs the message (so a developer can read a reset/verification link
 * straight out of the server logs) and keeps a bounded in-memory record of
 * everything "sent", which tests import directly to assert on without
 * standing up a real mail server.
 */
const MAX_RECORDED = 200;
const sent: MailMessage[] = [];

export class ConsoleMailTransport implements MailTransport {
  readonly id = 'console';

  async send(message: MailMessage): Promise<void> {
    sent.push(message);
    if (sent.length > MAX_RECORDED) {
      sent.splice(0, sent.length - MAX_RECORDED);
    }
    logger.info('[mail:console] message', {
      to: message.to,
      from: message.from,
      subject: message.subject,
      text: message.text,
    });
    return Promise.resolve();
  }
}

/** Test-only inspection API — never used by application code. */
export function getConsoleMailLog(): readonly MailMessage[] {
  return sent;
}

export function clearConsoleMailLog(): void {
  sent.length = 0;
}

export const consoleTransportDescriptor: MailTransportDescriptor = {
  id: 'console',
  displayName: 'Console (development)',
  async isConfigured() {
    return true;
  },
  async create() {
    return new ConsoleMailTransport();
  },
};
