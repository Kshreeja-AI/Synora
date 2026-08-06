import nodemailer, { type Transporter } from 'nodemailer';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import { MailTransportError, type MailMessage, type MailTransport } from '../types';
import type { MailTransportDescriptor } from '../types/descriptor';

/**
 * Real-world delivery via any SMTP-speaking provider (SES, SendGrid,
 * Postmark, Mailgun, a corporate relay, ...). Activated purely by setting
 * `MAIL_TRANSPORT=smtp` plus `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` — no
 * code change, no vendor SDK. This is the only file in the mail subsystem
 * that imports `nodemailer`.
 */
export class SmtpMailTransport implements MailTransport {
  readonly id = 'smtp';

  constructor(private readonly transporter: Transporter) {}

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        to: message.to,
        from: message.from,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (error) {
      throw new MailTransportError(
        `SMTP mail delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const smtpTransportDescriptor: MailTransportDescriptor = {
  id: 'smtp',
  displayName: 'SMTP',
  async isConfigured() {
    const host = getConfig().mail.smtpHost;
    if (!host) return false;
    // hasReal, not tryGet: a generated placeholder is not a credential a
    // real SMTP relay would accept.
    const hasUser = await secretsManager.hasReal('SMTP_USER', 'mail:smtp');
    const hasPassword = await secretsManager.hasReal('SMTP_PASSWORD', 'mail:smtp');
    return hasUser && hasPassword;
  },
  async create() {
    const { smtpHost, smtpPort, smtpSecure } = getConfig().mail;
    const user = await secretsManager.get('SMTP_USER', 'mail:smtp');
    const pass = await secretsManager.get('SMTP_PASSWORD', 'mail:smtp');

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user, pass },
    });

    return new SmtpMailTransport(transporter);
  },
};
