import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfig } from '../../config';
import { secretsManager } from '../../secrets';

vi.mock('../../config', () => ({ getConfig: vi.fn() }));
vi.mock('../../secrets', () => ({
  secretsManager: { tryGet: vi.fn(), get: vi.fn() },
}));

const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

import { smtpTransportDescriptor, SmtpMailTransport } from './smtp.transport';
import { MailTransportError } from '../types';

describe('smtp transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('is false when no SMTP host is set', async () => {
      (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mail: { smtpHost: undefined } });
      expect(await smtpTransportDescriptor.isConfigured()).toBe(false);
    });

    it('is false when host is set but credentials are missing', async () => {
      (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mail: { smtpHost: 'smtp.example.com' } });
      (secretsManager.tryGet as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      expect(await smtpTransportDescriptor.isConfigured()).toBe(false);
    });

    it('is true when host and credentials are all present', async () => {
      (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ mail: { smtpHost: 'smtp.example.com' } });
      (secretsManager.tryGet as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('secret-value');
      expect(await smtpTransportDescriptor.isConfigured()).toBe(true);
    });
  });

  describe('create', () => {
    it('builds a transport using SecretsManager credentials', async () => {
      (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        mail: { smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecure: false },
      });
      (secretsManager.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('secret-value');

      const transport = await smtpTransportDescriptor.create();
      expect(transport.id).toBe('smtp');
    });
  });

  describe('SmtpMailTransport.send', () => {
    it('delegates to the underlying nodemailer transporter', async () => {
      const transporter = { sendMail: sendMailMock };
      sendMailMock.mockResolvedValue(undefined);
      const transport = new SmtpMailTransport(transporter as never);

      await transport.send({
        to: 'user@example.com',
        from: 'Synora <noreply@synora.ai>',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
      });

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', subject: 'Hi' })
      );
    });

    it('wraps a delivery failure in MailTransportError', async () => {
      const transporter = { sendMail: vi.fn().mockRejectedValue(new Error('connection refused')) };
      const transport = new SmtpMailTransport(transporter as never);

      await expect(
        transport.send({
          to: 'user@example.com',
          from: 'Synora <noreply@synora.ai>',
          subject: 'Hi',
          html: '<p>Hi</p>',
          text: 'Hi',
        })
      ).rejects.toThrow(MailTransportError);
    });
  });
});
