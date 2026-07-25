import { renderEmailLayout, renderEmailButton } from './layout';
import type { MailContent } from '../types';

export function verifyEmailTemplate(params: { name: string | null; verifyUrl: string }): MailContent {
  const greeting = params.name ? `Hi ${params.name},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 16px;">Confirm your email address to finish setting up your Synora account.</p>
    ${renderEmailButton(params.verifyUrl, 'Verify email')}
    <p style="margin:24px 0 0;font-size:13px;color:#a3a3a3;">This link expires in 24 hours. If the button doesn't work, paste this URL into your browser:<br />${params.verifyUrl}</p>
  `;

  return {
    subject: 'Verify your Synora email address',
    html: renderEmailLayout({
      previewText: 'Confirm your email to finish setting up your Synora account.',
      heading: 'Verify your email',
      bodyHtml,
    }),
    text: `${greeting}\n\nConfirm your email address to finish setting up your Synora account:\n${params.verifyUrl}\n\nThis link expires in 24 hours.`,
  };
}
