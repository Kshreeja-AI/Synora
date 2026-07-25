import { renderEmailLayout } from './layout';
import type { MailContent } from '../types';

export function accountDeletedTemplate(params: { name: string | null }): MailContent {
  const greeting = params.name ? `Hi ${params.name},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0;">Your Synora account has been deleted, as you requested. You've been signed out of every device.</p>
    <p style="margin:16px 0 0;">If you didn't request this, contact support right away.</p>
  `;

  return {
    subject: 'Your Synora account has been deleted',
    html: renderEmailLayout({
      previewText: 'Your Synora account has been deleted, as you requested.',
      heading: 'Account deleted',
      bodyHtml,
    }),
    text: `${greeting}\n\nYour Synora account has been deleted, as you requested. You've been signed out of every device.\n\nIf you didn't request this, contact support right away.`,
  };
}
