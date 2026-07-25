import { renderEmailLayout, renderEmailButton } from './layout';
import type { MailContent } from '../types';

export function passwordResetTemplate(params: { name: string | null; resetUrl: string }): MailContent {
  const greeting = params.name ? `Hi ${params.name},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 16px;">We received a request to reset your Synora password. If you didn't make this request, you can ignore this email — your password won't change.</p>
    ${renderEmailButton(params.resetUrl, 'Reset password')}
    <p style="margin:24px 0 0;font-size:13px;color:#a3a3a3;">This link expires in 1 hour and can only be used once. If the button doesn't work, paste this URL into your browser:<br />${params.resetUrl}</p>
  `;

  return {
    subject: 'Reset your Synora password',
    html: renderEmailLayout({
      previewText: 'Reset your Synora password. This link expires in 1 hour.',
      heading: 'Reset your password',
      bodyHtml,
    }),
    text: `${greeting}\n\nWe received a request to reset your Synora password. If you didn't make this request, ignore this email.\n\n${params.resetUrl}\n\nThis link expires in 1 hour and can only be used once.`,
  };
}
