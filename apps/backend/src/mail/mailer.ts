import { getConfig } from '../config';
import { resolveMailTransport } from './resolver';
import { verifyEmailTemplate } from './templates/verifyEmail';
import { passwordResetTemplate } from './templates/passwordReset';
import { passwordChangedTemplate } from './templates/passwordChanged';
import { accountDeletedTemplate } from './templates/accountDeleted';
import { workspaceInvitationTemplate } from './templates/workspaceInvitation';
import type { MailContent } from './types';

/**
 * The functions the rest of the application calls to send transactional
 * mail. Everything about *how* delivery happens — which transport, its
 * credentials — is resolved internally. No caller ever names a transport or
 * imports a mail SDK.
 */
async function deliver(to: string, content: MailContent): Promise<void> {
  const transport = await resolveMailTransport();
  const { fromAddress, fromName } = getConfig().mail;
  await transport.send({
    to,
    from: `${fromName} <${fromAddress}>`,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

export async function sendVerificationEmail(params: {
  to: string;
  name: string | null;
  token: string;
}): Promise<void> {
  const verifyUrl = `${getConfig().urls.frontendUrl}/auth/verify-email?token=${encodeURIComponent(params.token)}`;
  await deliver(params.to, verifyEmailTemplate({ name: params.name, verifyUrl }));
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string | null;
  token: string;
}): Promise<void> {
  const resetUrl = `${getConfig().urls.frontendUrl}/auth/reset-password?token=${encodeURIComponent(params.token)}`;
  await deliver(params.to, passwordResetTemplate({ name: params.name, resetUrl }));
}

export async function sendPasswordChangedEmail(params: {
  to: string;
  name: string | null;
}): Promise<void> {
  await deliver(params.to, passwordChangedTemplate({ name: params.name }));
}

export async function sendAccountDeletedEmail(params: {
  to: string;
  name: string | null;
}): Promise<void> {
  await deliver(params.to, accountDeletedTemplate({ name: params.name }));
}

export async function sendWorkspaceInvitationEmail(params: {
  to: string;
  workspaceName: string;
  inviterName: string | null;
  role: string;
  token: string;
}): Promise<void> {
  const acceptUrl = `${getConfig().urls.frontendUrl}/invite/${encodeURIComponent(params.token)}`;
  await deliver(
    params.to,
    workspaceInvitationTemplate({
      workspaceName: params.workspaceName,
      inviterName: params.inviterName,
      role: params.role,
      acceptUrl,
    })
  );
}
