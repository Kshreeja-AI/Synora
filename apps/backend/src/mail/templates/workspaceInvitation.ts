import { renderEmailLayout, renderEmailButton } from './layout';
import type { MailContent } from '../types';

export function workspaceInvitationTemplate(params: {
  workspaceName: string;
  inviterName: string | null;
  role: string;
  acceptUrl: string;
}): MailContent {
  const inviter = params.inviterName ?? 'A workspace admin';
  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0;">${inviter} invited you to join <strong>${params.workspaceName}</strong> on Synora as a${
      params.role === 'ADMIN' ? 'n' : ''
    } ${params.role.toLowerCase()}.</p>
    <p style="margin:16px 0 0;">This invitation expires in 7 days.</p>
    ${renderEmailButton(params.acceptUrl, 'Accept invitation')}
  `;

  return {
    subject: `You're invited to join ${params.workspaceName} on Synora`,
    html: renderEmailLayout({
      previewText: `${inviter} invited you to join ${params.workspaceName} on Synora.`,
      heading: 'Workspace invitation',
      bodyHtml,
    }),
    text: `Hi,\n\n${inviter} invited you to join ${params.workspaceName} on Synora as a ${params.role.toLowerCase()}.\n\nAccept: ${params.acceptUrl}\n\nThis invitation expires in 7 days.`,
  };
}
