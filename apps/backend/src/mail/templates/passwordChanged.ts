import { renderEmailLayout } from './layout';
import type { MailContent } from '../types';

export function passwordChangedTemplate(params: { name: string | null }): MailContent {
  const greeting = params.name ? `Hi ${params.name},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0;">Your Synora password was just changed. Every other device has been signed out as a precaution.</p>
    <p style="margin:16px 0 0;">If this wasn't you, reset your password immediately and contact support.</p>
  `;

  return {
    subject: 'Your Synora password was changed',
    html: renderEmailLayout({
      previewText: 'Your Synora password was just changed.',
      heading: 'Password changed',
      bodyHtml,
    }),
    text: `${greeting}\n\nYour Synora password was just changed. Every other device has been signed out as a precaution.\n\nIf this wasn't you, reset your password immediately and contact support.`,
  };
}
